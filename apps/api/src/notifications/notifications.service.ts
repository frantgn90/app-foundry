import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { Entorno } from '@app-foundry/core';
import {
  apps,
  comments,
  commentThreads,
  documents,
  documentVersions,
  notifications,
  users,
} from '@app-foundry/db';

import { currentTx } from '@app-foundry/platform';
import { MetricsService } from '../observability/metrics.service.js';
import type { NotificationDto, NotificationListDto } from './notifications.dto.js';
import { NotificationsChannel } from './notifications.channel.js';
import {
  type AvisoEmitido,
  type Emision,
  NotificationEmitter,
  NotificationsStream,
} from '@app-foundry/notifications';

/** Un aviso ya escrito, para que el canal en tiempo real pueda repartirlo. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly emitter: NotificationEmitter,
    private readonly stream: NotificationsStream,
    private readonly channel: NotificationsChannel,
    private readonly metrics: MetricsService,
  ) {}

  /** Abre una conexión de avisos en tiempo real. Ver `NotificationsChannel`. */
  async abrirCanal(
    userId: string,
    request: Parameters<NotificationsChannel['abrir']>[1],
    response: Parameters<NotificationsChannel['abrir']>[2],
    lastEventId?: string,
  ): Promise<void> {
    return this.channel.abrir(userId, request, response, lastEventId);
  }

  /**
   * Escribe los avisos de una acción, en su misma transacción.
   *
   * Delega en el emisor compartido: escribir avisos lo hacen dos procesos —esta
   * API y el worker— y tenerlo aquí obligaba al segundo a depender de la
   * primera. Lo que se queda en este servicio es lo que solo ocurre sobre una
   * petición: leerlos, marcarlos y contarlos.
   */
  async emit(entrada: Emision): Promise<AvisoEmitido[]> {
    return this.emitter.emit(entrada);
  }

  /**
   * Los avisos del usuario, recientes primero.
   *
   * El contador de pendientes se cuenta aparte y no se deduce de la página
   * devuelta: si se dedujera, pedir veinte avisos daría un contador de veinte
   * como mucho, y el número que se enseña dejaría de ser cierto en cuanto
   * hubiera más.
   */
  async list(userId: string, limit = 30): Promise<NotificationListDto> {
    const tx = currentTx();
    const tope = Math.min(Math.max(Number.isFinite(limit) ? limit : 30, 1), 100);

    const filas = await tx
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(tope);

    return { items: filas.map(aDto), unread: await this.unread(userId) };
  }

  /** Marca leídos. Sin lista, todos los pendientes (RF-903). */
  async markRead(userId: string, ids?: string[]): Promise<NotificationListDto> {
    const tx = currentTx();

    // Las políticas ya limitan el alcance a lo propio, así que no hace falta
    // filtrar por usuario: cualquier identificador ajeno sencillamente no
    // encuentra fila.
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        ids && ids.length > 0
          ? and(inArray(notifications.id, ids), isNull(notifications.readAt))
          : isNull(notifications.readAt),
      );

    return this.list(userId);
  }

  /**
   * Purga manual (RF-909).
   *
   * Sin identificadores vacía lo ya leído, no todo: tirar de un botón no debería
   * llevarse por delante lo que aún no has mirado.
   *
   * Borrar un aviso no toca aquello a lo que apuntaba (RF-911); la tabla no
   * tiene ninguna baja en cascada hacia comentarios ni versiones.
   */
  async purge(userId: string, ids?: string[]): Promise<NotificationListDto> {
    const tx = currentTx();

    await tx
      .delete(notifications)
      .where(
        ids && ids.length > 0 ? inArray(notifications.id, ids) : isNotNull(notifications.readAt),
      );

    return this.list(userId);
  }

  private async unread(userId: string): Promise<number> {
    const [fila] = await currentTx()
      .select({ total: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return fila?.total ?? 0;
  }

  /**
   * Quién ronda una app: su precursor y quienes ya se han implicado en ella.
   *
   * «Implicarse» es haber comentado o haber guardado una versión, no tener
   * permiso para hacerlo: el acceso de escritura a un workspace entero no
   * significa querer enterarse de todas sus apps (RF-902).
   */
  async entornoDeApp(
    appId: string,
    actor: string,
  ): Promise<{
    entorno: Entorno;
    workspaceId: string;
    appName: string;
    actorHandle: string;
  }> {
    const tx = currentTx();

    const [app] = await tx
      .select({
        workspaceId: apps.workspaceId,
        name: apps.name,
        precursorId: apps.precursorId,
      })
      .from(apps)
      .where(eq(apps.id, appId));
    if (!app) throw new NotFoundException('The app does not exist');

    /*
     * Personas: haber comentado implica a quien comenta, y un agente no se
     * implica en nada ni recibe avisos (RF-1612). Filtrarlo aquí y no al
     * repartir es lo que evita que aparezca en la audiencia de un aviso futuro
     * sin que nadie se dé cuenta.
     */
    const comentaristas = await tx
      .selectDistinct({ userId: comments.authorId })
      .from(comments)
      .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
      .where(and(eq(commentThreads.appId, appId), isNotNull(comments.authorId)));

    const editores = await tx
      .selectDistinct({ userId: documentVersions.authorId })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(eq(documents.appId, appId));

    const [quien] = await tx
      .select({ handle: users.handle })
      .from(users)
      .where(eq(users.id, actor));

    return {
      entorno: {
        actor,
        precursor: app.precursorId,
        participantes: [...comentaristas, ...editores].map((r) => r.userId!),
      },
      workspaceId: app.workspaceId,
      appName: app.name,
      actorHandle: quien?.handle ?? '',
    };
  }

  /**
   * Descarta a quien ya no pertenece al workspace.
   *
   * Puede pasar: el precursor de una app sigue siéndolo aunque le hayan sacado
   * del workspace, y la política de la tabla rechazaría escribirle. Ese rechazo
   * abortaría la transacción entera, así que quien se quedaría sin comentario es
   * quien lo estaba escribiendo, por un aviso que no le incumbe. Se filtra aquí
   * y la política queda de red de seguridad, que es su papel.
   */
}

function aDto(fila: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: fila.id,
    type: fila.type,
    payload: fila.payload,
    workspaceId: fila.workspaceId,
    appId: fila.appId,
    threadId: fila.threadId,
    readAt: fila.readAt?.toISOString() ?? null,
    createdAt: fila.createdAt.toISOString(),
  };
}

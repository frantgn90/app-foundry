import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { audiencia, type Entorno, type NotificationType, uuidv7 } from '@app-foundry/core';
import {
  apps,
  comments,
  commentThreads,
  documents,
  documentVersions,
  notifications,
  users,
  workspaceMembers,
} from '@app-foundry/db';

import { currentTx, trasCommit } from '../database/request-context.js';
import { MetricsService } from '../observability/metrics.service.js';
import type { NotificationDto, NotificationListDto } from './notifications.dto.js';
import { NotificationsChannel } from './notifications.channel.js';
import { NotificationsStream } from './notifications.stream.js';

export interface Emision {
  type: NotificationType;
  entorno: Entorno;
  workspaceId: string;
  appId?: string | null;
  threadId?: string | null;
  /**
   * Lo necesario para pintar el aviso sin volver a consultar nada. Es una foto
   * del momento: si mañana se borra el comentario, el aviso sigue leyéndose.
   */
  payload: Record<string, unknown>;
}

/** Un aviso ya escrito, para que el canal en tiempo real pueda repartirlo. */
export interface AvisoEmitido {
  id: string;
  userId: string;
  type: NotificationType;
}

@Injectable()
export class NotificationsService {
  constructor(
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
   * Va dentro de la transacción a propósito: si la acción se deshace, sus avisos
   * tampoco existen. Recibir un «han comentado tu app» de un comentario que
   * nunca llegó a guardarse es peor que no recibir nada, porque manda a mirar
   * algo que no está.
   *
   * El identificador se genera aquí y no en la base de datos porque un aviso es
   * de quien lo recibe: las políticas no dejan releer lo que acabas de escribir
   * para otro, así que `RETURNING` no puede devolverlo.
   */
  async emit(entrada: Emision): Promise<AvisoEmitido[]> {
    const previstos = audiencia(entrada.type, entrada.entorno);
    if (previstos.length === 0) return [];

    const alcanzables = await this.alcanzables(
      entrada.workspaceId,
      previstos.map((a) => a.userId),
      entrada.type,
    );
    const avisos = previstos
      .filter((a) => alcanzables.has(a.userId))
      .map((a) => ({ id: uuidv7(), userId: a.userId, type: a.type }));
    if (avisos.length === 0) return [];

    const creado = new Date().toISOString();
    await currentTx()
      .insert(notifications)
      .values(
        avisos.map((a) => ({
          id: a.id,
          userId: a.userId,
          type: a.type,
          workspaceId: entrada.workspaceId,
          appId: entrada.appId ?? null,
          threadId: entrada.threadId ?? null,
          payload: entrada.payload,
        })),
      );

    /*
     * El reparto espera al commit. Publicado aquí mismo, un aviso podría llegar
     * al navegador y desaparecer un instante después si el guardado falla,
     * dejando a alguien mirando algo que no existe.
     */
    this.metrics.avisosEmitidos(avisos.length);

    trasCommit(async () => {
      for (const a of avisos) {
        await this.stream.publicar(a.userId, { id: a.id, type: a.type, createdAt: creado });
      }
    });

    return avisos;
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

    const comentaristas = await tx
      .selectDistinct({ userId: comments.authorId })
      .from(comments)
      .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
      .where(eq(commentThreads.appId, appId));

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
        participantes: [...comentaristas, ...editores].map((r) => r.userId),
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
  private async alcanzables(
    workspaceId: string,
    candidatos: string[],
    type: NotificationType,
  ): Promise<Set<string>> {
    // Al invitar, el destinatario todavía no es miembro: ahí la comprobación de
    // que la invitación existe la hace la propia política.
    if (type === 'WORKSPACE_INVITED') return new Set(candidatos);

    const miembros = await currentTx()
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          inArray(workspaceMembers.userId, candidatos),
        ),
      );

    return new Set(miembros.map((m) => m.userId));
  }
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

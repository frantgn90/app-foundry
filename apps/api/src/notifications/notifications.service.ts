import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

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

import { currentTx } from '../database/request-context.js';

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

    return avisos;
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

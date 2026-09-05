import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { audiencia, type Entorno, type NotificationType, uuidv7 } from '@app-foundry/core';
import { notifications, workspaceMembers } from '@app-foundry/db';
import { currentTx, trasCommit } from '@app-foundry/platform';

import { NOTIFICATION_METRICS, type NotificationMetricsPort } from './ports.js';
import { NotificationsStream } from './stream.service.js';

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
  /**
   * Quienes han pedido no oír esto (RF-1612).
   *
   * Va como lista y no como una regla que el emisor evalúe: de momento el único
   * silencio del producto es «este agente en concreto», y meter esa noción aquí
   * obligaría a este paquete a saber qué es un agente. Quien llama sabe por qué
   * silencia; esto solo descarta.
   */
  silenciados?: string[];
}

/** Lo emitido, para que quien lo provocó pueda contarlo o encadenarlo. */
export interface AvisoEmitido {
  id: string;
  userId: string;
  type: NotificationType;
}

/**
 * Quien escribe los avisos.
 *
 * Vive en su propio paquete por la misma razón que el paso común de invocación:
 * hay **dos** procesos que avisan. La API avisa de lo que hace la gente, y el
 * worker de lo que ocurre atendiendo a un agente —que el cupo se acerca a su
 * techo, sobre todo—. Con esto dentro de `apps/api`, o el worker dependía de la
 * API entera o se quedaba mudo, y entonces un workspace que solo usara agentes
 * no recibiría nunca el aviso de cupo (RF-1205).
 *
 * Lo que **no** entra aquí: leer los avisos, marcarlos, purgarlos y servir el
 * SSE. Eso son pantallas y rutas, y se quedan en la API.
 */
@Injectable()
export class NotificationEmitter {
  constructor(
    private readonly stream: NotificationsStream,
    @Inject(NOTIFICATION_METRICS) private readonly metrics: NotificationMetricsPort,
  ) {}

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
    const callados = new Set(entrada.silenciados ?? []);
    const avisos = previstos
      .filter((a) => alcanzables.has(a.userId) && !callados.has(a.userId))
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

    this.metrics.avisosEmitidos(avisos.length);

    /*
     * El reparto espera al commit. Publicado aquí mismo, un aviso podría llegar
     * al navegador y desaparecer un instante después si el guardado falla,
     * dejando a alguien mirando algo que no existe.
     */
    trasCommit(async () => {
      for (const a of avisos) {
        await this.stream.publicar(a.userId, { id: a.id, type: a.type, createdAt: creado });
      }
    });

    return avisos;
  }

  /** Quién de los previstos sigue pudiendo recibir en este workspace (RF-908). */
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

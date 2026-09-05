import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';

import {
  AGENT_REPLY_QUEUE,
  type AgentReplyJob,
  agentReplyJobId,
  AgentTrigger,
} from '@app-foundry/core';
import { agents, comments } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';
import { currentTx, ENV, trasCommit } from '@app-foundry/platform';

/**
 * Quien encola las respuestas de agente (RF-1602, T-32).
 *
 * De los tres disparos, aquí viven dos: la **mención** de una persona y su
 * **réplica** en un hilo donde el agente ya escribió. El tercero —la revisión—
 * llega en H13 con su propia cola.
 *
 * Lo que este servicio decide es a quién despertar. Si además debe hablar
 * cuando le toque el turno lo vuelve a mirar el worker, porque entre encolar y
 * ejecutar pueden pasar minutos y en ese hueco al agente lo pueden haber
 * desactivado o retirado.
 */
@Injectable()
export class AgentQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(AgentQueueService.name);
  private readonly queue: Queue<AgentReplyJob>;
  private readonly redis: Redis;

  /**
   * Conexión propia, no la compartida de la aplicación.
   *
   * La del resto de la API es perezosa y con los reintentos acotados, que es lo
   * correcto para comandos sueltos dentro de una petición. BullMQ espera otra
   * cosa, y con la compartida encolar fallaba con «Connection is closed»: el
   * comentario se guardaba y el agente no contestaba nunca. Se descubrió
   * mandando una mención desde la pantalla, no en los tests, donde cada uno
   * abre la suya.
   */
  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<AgentReplyJob>(AGENT_REPLY_QUEUE, { connection: this.redis });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.redis.disconnect();
  }

  /**
   * Despierta a quien toque por un comentario recién escrito por una persona.
   *
   * Solo lo llama quien acaba de insertar un comentario **de una persona**, que
   * es el cortafuegos de RF-1604 en la condición de entrada (T-35): lo escrito
   * por un agente no despierta a nadie. No se comprueba aquí porque no hay otro
   * camino que llegue —los comentarios de agente los escribe el worker por la
   * función del motor, no por este servicio—, y el worker lo vuelve a mirar de
   * todos modos antes de contestar.
   */
  async despertar(entrada: {
    threadId: string;
    commentId: string;
    actorUserId: string;
    /** Los que ha invocado explícitamente el texto del comentario. */
    mencionados: string[];
  }): Promise<void> {
    const replicas = await this.yaEscribieronAqui(entrada.threadId, entrada.mencionados);

    const trabajos: AgentReplyJob[] = [
      ...entrada.mencionados.map((agentId) => ({
        agentId,
        threadId: entrada.threadId,
        triggerCommentId: entrada.commentId,
        actorUserId: entrada.actorUserId,
        trigger: AgentTrigger.MENTION,
      })),
      ...replicas.map((agentId) => ({
        agentId,
        threadId: entrada.threadId,
        triggerCommentId: entrada.commentId,
        actorUserId: entrada.actorUserId,
        trigger: AgentTrigger.REPLY,
      })),
    ];
    if (trabajos.length === 0) return;

    /*
     * Se encola **después del commit**, no aquí mismo. Encolado dentro de la
     * transacción, un fallo posterior la desharía y el worker se despertaría
     * para contestar a un comentario que no llegó a existir: leería un
     * identificador que no está y el trabajo moriría, pero habiendo consumido
     * su turno y su hueco de cola.
     */
    trasCommit(async () => {
      for (const trabajo of trabajos) {
        try {
          await this.queue.add(trabajo.trigger, trabajo, {
            /* Clave de idempotencia: el mismo comentario no despierta dos veces al mismo (T-33). */
            jobId: agentReplyJobId(trabajo),
            /*
             * El techo de intentos lo pone la cola; **cuáles se usan lo decide
             * la taxonomía de errores** (RNF-703). Sin este número BullMQ no
             * reintenta nunca, y el `UnrecoverableError` que el worker lanza
             * para lo que no merece reintento no distinguiría nada de nada.
             * Cuatro es el máximo de la política: el de `RATE_LIMIT`, que es el
             * único fallo que se arregla precisamente por esperar.
             */
            attempts: 4,
            backoff: { type: 'custom' },
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          });
        } catch (error) {
          /*
           * Que Redis no esté no puede tumbar un comentario que ya se guardó.
           * Se pierde la respuesta del agente, y eso se nota y se puede volver
           * a pedir mencionándolo otra vez; perder el comentario, no.
           */
          this.logger.warn(
            `No se pudo encolar la respuesta de ${trabajo.agentId}; el comentario está guardado: ${String(error)}`,
          );
        }
      }
    });
  }

  /**
   * Los agentes que ya escribieron en este hilo (RF-1602, disparo 3).
   *
   * Activos y no retirados: uno apagado no vuelve solo porque alguien siga
   * hablando en un hilo donde una vez participó.
   *
   * Se excluyen los que el texto menciona explícitamente, porque esos ya entran
   * por el otro disparo, y con más derecho: una mención levanta el tope de
   * turnos y una réplica no (RF-1605).
   */
  private async yaEscribieronAqui(threadId: string, excluidos: string[]): Promise<string[]> {
    const filas = await currentTx()
      .selectDistinct({ agentId: comments.authorAgentId })
      .from(comments)
      .innerJoin(agents, eq(agents.id, comments.authorAgentId))
      .where(
        and(
          eq(comments.threadId, threadId),
          eq(agents.active, true),
          isNull(agents.removedAt),
          isNull(comments.deletedAt),
        ),
      );

    return filas
      .map((f) => f.agentId)
      .filter((id): id is string => id !== null && !excluidos.includes(id));
  }
}

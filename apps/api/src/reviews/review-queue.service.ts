import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  AGENT_REVIEW_QUEUE,
  type AgentReviewJob,
  agentReviewJobId,
  reviewCancelKey,
} from '@app-foundry/core';
import type { Env } from '@app-foundry/env';
import { ENV, trasCommit } from '@app-foundry/platform';

/** Cuánto vive la marca de cancelación. De sobra para lo que dura una revisión. */
const CANCELACION_TTL_S = 3_600;

/**
 * Quien encola el abanico y quien lo para (RF-1606, RF-1610, T-32).
 *
 * Un trabajo por agente, todos de una tacada. La alternativa —un trabajo por
 * revisión que recorriera los agentes— ataba el reintento, la cancelación y el
 * progreso a la revisión entera: un agente que falla obligaría a repetirlos
 * todos, incluidos los que ya escribieron.
 */
@Injectable()
export class ReviewQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(ReviewQueueService.name);
  private readonly queue: Queue<AgentReviewJob>;
  private readonly redis: Redis;

  /**
   * Conexión propia, como la de las respuestas y por lo mismo: la compartida de
   * la aplicación es perezosa y con los reintentos acotados, que es lo correcto
   * para comandos sueltos dentro de una petición y no lo que BullMQ espera.
   */
  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<AgentReviewJob>(AGENT_REVIEW_QUEUE, { connection: this.redis });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.redis.disconnect();
  }

  /**
   * Encola el abanico **después del commit**.
   *
   * Si se encolara dentro de la transacción, un fallo posterior dejaría cinco
   * trabajos buscando una revisión que nunca existió; y el worker es otro
   * proceso, así que puede empezar antes de que esta termine.
   */
  encolar(trabajos: readonly AgentReviewJob[]): void {
    trasCommit(async () => {
      await this.queue.addBulk(
        trabajos.map((job) => ({
          name: 'review',
          data: job,
          opts: {
            jobId: agentReviewJobId(job),
            /*
             * El reintento lo decide la taxonomía de errores; aquí solo el
             * techo. Lo que no merece otra oportunidad muere en el primer
             * intento como `UnrecoverableError` (RNF-703).
             */
            attempts: 4,
            backoff: { type: 'custom' },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        })),
      );
    });
  }

  /**
   * Marca la revisión como cancelada y quita de la cola lo que no ha empezado.
   *
   * Las dos cosas, porque cubren momentos distintos: quitar de la cola evita
   * que arranquen los que esperan, y la marca es lo que ve el worker de los que
   * ya están dentro —al empezar y entre pasos— para no seguir gastando
   * (RF-1610). Lo ya escrito se queda.
   */
  cancelar(reviewId: string, agentIds: readonly string[]): void {
    trasCommit(async () => {
      await this.redis.set(reviewCancelKey(reviewId), '1', 'EX', CANCELACION_TTL_S);

      for (const agentId of agentIds) {
        try {
          const job = await this.queue.getJob(agentReviewJobId({ reviewId, agentId }));
          /* `remove` falla si ya está en marcha: ahí manda la marca. */
          if (job) await job.remove();
        } catch {
          /* Que no se pueda quitar no cambia el desenlace: la marca lo para. */
        }
      }
    });
  }

  /** Si la revisión sigue cancelada, para quien quiera comprobarlo desde la API. */
  async cancelada(reviewId: string): Promise<boolean> {
    return (await this.redis.exists(reviewCancelKey(reviewId))) === 1;
  }
}

import { Redis } from 'ioredis';

import { AGENT_REPLY_QUEUE } from '@app-foundry/core';
import { createDb } from '@app-foundry/db';
import { loadEnv } from '@app-foundry/env';

import { createWorkerLogger } from './logger.js';
import { startAgentReplyWorker } from './agent-reply.worker.js';

/**
 * El consumidor de las colas de IA (TRD §4, §11.2).
 *
 * Proceso aparte de la API desde el primer día, y no por gusto: cinco agentes
 * revisando a la vez comparten CPU y límite de tasa con quien está navegando,
 * y en H13 una revisión dura minutos. Separado, un pico de trabajos no degrada
 * la navegación de nadie (RNF-705, TRD §17).
 *
 * Aquí solo se monta y se desmonta. Lo que hace cada trabajo vive en su propio
 * fichero.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const log = createWorkerLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  /*
   * BullMQ necesita bloquear en Redis mientras espera trabajo, y para eso pide
   * `maxRetriesPerRequest: null`: con reintentos limitados, una desconexión
   * pasajera mataría al consumidor en vez de esperar a que Redis vuelva.
   */
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const { db, close: closeDb } = createDb(env.DATABASE_URL);

  const worker = startAgentReplyWorker({ redis, db, env, log });

  log.info(
    { queue: AGENT_REPLY_QUEUE, concurrency: env.AI_WORKER_CONCURRENCY },
    'worker listo, esperando trabajo',
  );

  /*
   * Apagado ordenado: se deja de aceptar trabajo y se espera a que termine el
   * que hay en marcha. Cortar a mitad dejaría una respuesta a medio escribir, y
   * aunque la transacción la deshace, el trabajo se habría dado por consumido.
   */
  const apagar = async (señal: string): Promise<void> => {
    log.info({ señal }, 'apagando: se termina lo que hay empezado');
    await worker.close();
    await closeDb();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

void bootstrap();

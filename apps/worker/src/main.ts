import 'reflect-metadata';

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Redis } from 'ioredis';

import { AGENT_REPLY_QUEUE } from '@app-foundry/core';
import type { Database } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';
import { NotificationEmitter } from '@app-foundry/notifications';
import { DATABASE, DB_HANDLE, ENV, REDIS } from '@app-foundry/platform';
import type { DbHandle } from '@app-foundry/db';

import { startAgentReplyWorker } from './agent-reply.worker.js';
import { AskModel } from './ask-model.js';
import { WorkerAiModule } from './ai.module.js';

@Module({ imports: [WorkerAiModule], providers: [AskModel, NotificationEmitter] })
class WorkerModule {}

/**
 * El consumidor de las colas de IA (TRD §4, §11.2).
 *
 * Proceso aparte de la API desde el primer día, y no por gusto: cinco agentes
 * revisando a la vez comparten CPU y límite de tasa con quien está navegando, y
 * en H13 una revisión dura minutos. Separado, un pico de trabajos no degrada la
 * navegación de nadie (RNF-705, TRD §17).
 *
 * Es un contexto de aplicación de Nest y no un servidor: no atiende peticiones,
 * así que no abre ningún puerto. Lo que gana montando el contenedor es poder
 * usar exactamente las mismas piezas que la API para invocar y para avisar.
 */
async function bootstrap(): Promise<void> {
  const log = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    abortOnError: false,
  });

  const env = app.get<Env>(ENV);
  const db = app.get<Database>(DATABASE);
  const redis = app.get<Redis>(REDIS);
  const ask = app.get(AskModel);
  const emisor = app.get(NotificationEmitter);

  const worker = startAgentReplyWorker({
    redis,
    db,
    env,
    log,
    ask: (peticion) => ask.ask(peticion),
    notify: (aviso) => emisor.emit(aviso),
  });

  log.log(
    `worker listo en ${AGENT_REPLY_QUEUE}, concurrencia ${String(env.AI_WORKER_CONCURRENCY)}`,
  );

  /*
   * Apagado ordenado: se deja de aceptar trabajo y se espera a que termine el
   * que hay en marcha. Cortar a mitad dejaría el trabajo dado por consumido
   * aunque su transacción se deshaga, y esa respuesta no volvería a intentarse.
   */
  const apagar = async (señal: string): Promise<void> => {
    log.log(`${señal}: apagando, se termina lo que hay empezado`);
    await worker.close();
    await app.get<DbHandle>(DB_HANDLE).close();
    redis.disconnect();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

void bootstrap();

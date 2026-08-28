import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { createDb, type DbHandle } from '@app-foundry/db';
import { type Env, loadEnv } from '@app-foundry/env';

import { DATABASE, DB_HANDLE, ENV, REDIS } from './tokens.js';

/**
 * Conexiones compartidas por toda la aplicación.
 *
 * La configuración se valida aquí, al construir el módulo: si falta una
 * variable, el proceso muere en el arranque con un mensaje claro en lugar de
 * fallar más tarde en la petición de alguien.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => loadEnv(),
    },
    {
      // Un único pool para todo el proceso: el handle guarda el pool y su
      // cierre, y DATABASE es simplemente el cliente que cuelga de él.
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: (env: Env): DbHandle => createDb(env.DATABASE_URL),
    },
    {
      provide: DATABASE,
      inject: [DB_HANDLE],
      useFactory: (handle: DbHandle) => handle.db,
    },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          // Que un Redis caído no bloquee el arranque: la salud lo reportará.
          lazyConnect: false,
          enableOfflineQueue: false,
        }),
    },
  ],
  exports: [ENV, DATABASE, DB_HANDLE, REDIS],
})
export class InfrastructureModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_HANDLE) private readonly dbHandle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Cierra las conexiones al apagar, para no dejar el pool colgando. */
  async onApplicationShutdown(): Promise<void> {
    await this.dbHandle.close();
    this.redis.disconnect();
  }
}

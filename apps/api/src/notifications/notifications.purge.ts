import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

import type { Database } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';

import { DATABASE, ENV, REDIS } from '../infrastructure/tokens.js';

/** Cada cuánto se revisa. No hace falta más: nada de esto es urgente. */
const CADA_MS = 60 * 60 * 1000;
/** Un respiro tras arrancar, para no competir con el resto del arranque. */
const PRIMERA_MS = 60 * 1000;
const CERROJO = 'notif:purge:lock';

/**
 * Recorta los avisos para que no crezcan sin límite (RF-910).
 *
 * Por antigüedad de lo ya leído, y por un tope de avisos por persona. El tope es
 * el que de verdad acota: sin él, alguien que nunca lee nada acumularía sin
 * final, y el listado y el contador se irían degradando hasta no servir.
 *
 * Se programa con un temporizador en lugar de traer una biblioteca de tareas:
 * es una sola tarea, sin calendario ni reintentos, y añadir una dependencia para
 * esto no sale a cuenta.
 */
@Injectable()
export class NotificationsPurge implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsPurge.name);
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.temporizador = setInterval(() => void this.purgar(), CADA_MS);
    // `unref` para que un temporizador dormido no mantenga vivo el proceso al
    // apagarlo, ni deje colgados los tests.
    this.temporizador.unref();

    const primera = setTimeout(() => void this.purgar(), PRIMERA_MS);
    primera.unref();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /**
   * Purga una vez, si a esta instancia le toca.
   *
   * El cerrojo en Redis evita que varias instancias hagan a la vez el mismo
   * borrado: no daría un resultado incorrecto, pero sí varias pasadas de una
   * consulta que recorre toda la tabla. Caduca solo, así que una instancia que
   * muera a mitad no deja la purga bloqueada para siempre.
   */
  async purgar(): Promise<number> {
    const tomado = await this.redis.set(CERROJO, '1', 'EX', 300, 'NX').catch(() => null);
    if (tomado === null) return 0;

    try {
      const filas = await this.db.execute<{ notif_purge: number }>(
        sql`SELECT notif_purge(${this.env.NOTIF_RETENTION_DAYS}, ${this.env.NOTIF_MAX_PER_USER})`,
      );
      const borradas = filas.rows[0]?.notif_purge ?? 0;
      if (borradas > 0) {
        this.logger.log(`Purgados ${String(borradas)} avisos`);
      }
      return borradas;
    } catch (error) {
      // Que la purga falle no puede tumbar la aplicación: se reintenta a la
      // hora siguiente y mientras tanto todo lo demás sigue funcionando.
      this.logger.error({ err: error }, 'La purga de avisos falló');
      return 0;
    } finally {
      await this.redis.del(CERROJO).catch(() => undefined);
    }
  }
}

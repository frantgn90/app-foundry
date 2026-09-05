import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

import type { AiProvider } from '@app-foundry/core';
import type { Database } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';

import { conIdentidad } from '@app-foundry/platform';
import { DATABASE, ENV, REDIS } from '../infrastructure/tokens.js';
import { AiCatalogService } from './catalog.service.js';

/** Cada cuánto se mira si toca refrescar. El catálogo de un proveedor cambia poco. */
const CADA_MS = 60 * 60 * 1000;
/** Un respiro tras arrancar, para no competir con el resto del arranque. */
const PRIMERA_MS = 30 * 1000;
const CERROJO = 'ai:catalog:refresh:lock';

interface Candidato extends Record<string, unknown> {
  workspace_id: string;
  provider: AiProvider;
  owner_id: string;
}

/**
 * Mantiene al día el catálogo de modelos, en segundo plano (RF-1009).
 *
 * El catálogo **no se pide al pintar una pantalla**: se sirve siempre de la
 * caché. Aquí se refresca cuando envejece, y en el momento de configurar un
 * proveedor, que es cuando de verdad hace falta que aparezca.
 *
 * Si el proveedor no responde, no pasa nada: lo último que se supo sigue en la
 * base de datos y se sigue sirviendo. El fallo se anota y se reintenta a la hora
 * siguiente.
 *
 * Mismo patrón que la purga de avisos: un temporizador y un cerrojo en Redis,
 * en lugar de una biblioteca de tareas para dos temporizadores.
 */
@Injectable()
export class AiCatalogRefresh implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AiCatalogRefresh.name);
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    private readonly catalog: AiCatalogService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.temporizador = setInterval(() => void this.refrescar(), CADA_MS);
    this.temporizador.unref();

    const primera = setTimeout(() => void this.refrescar(), PRIMERA_MS);
    primera.unref();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /**
   * Refresca los catálogos que hayan envejecido, si a esta instancia le toca.
   *
   * Devuelve cuántos proveedores se refrescaron. En régimen normal, cero: la
   * consulta solo devuelve candidatos cuando el catálogo está viejo.
   */
  async refrescar(): Promise<number> {
    const tomado = await this.redis.set(CERROJO, '1', 'EX', 300, 'NX').catch(() => null);
    if (tomado === null) return 0;

    try {
      const candidatos = await this.candidatos();
      let refrescados = 0;

      for (const candidato of candidatos) {
        /*
         * Con la identidad del dueño del workspace: la función que entrega el
         * secreto exige que haya una persona detrás, y aquí la persona es quien
         * puso la credencial (AP3).
         */
        try {
          await conIdentidad(this.db, candidato.owner_id, () =>
            this.catalog.refresh(candidato.workspace_id, candidato.provider),
          );
          refrescados += 1;
        } catch (error) {
          /*
           * Un proveedor que no contesta no puede impedir que se refresquen los
           * demás, ni tumbar el proceso. Lo último que se supo de él sigue
           * sirviendo.
           */
          this.logger.warn(
            `No se pudo refrescar el catálogo de ${candidato.provider}: ${mensajeDe(error)}`,
          );
        }
      }

      if (refrescados > 0) {
        this.logger.log(`Catálogo refrescado de ${String(refrescados)} proveedor(es)`);
      }
      return refrescados;
    } finally {
      await this.redis.del(CERROJO).catch(() => undefined);
    }
  }

  private async candidatos(): Promise<Candidato[]> {
    const horas = this.env.AI_MODEL_CATALOG_TTL_HOURS;
    const filas = await this.db.execute<Candidato>(
      sql`SELECT * FROM ai_catalog_refresh_candidates(make_interval(hours => ${horas}))`,
    );
    return [...filas.rows];
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : 'motivo desconocido';
}

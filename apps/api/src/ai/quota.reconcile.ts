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

import { DATABASE, REDIS } from '../infrastructure/tokens.js';
import { AiQuotaService } from './quota.service.js';

/** Una vez al día basta: corrige un desfase, no lleva la cuenta. */
const CADA_MS = 24 * 60 * 60 * 1000;
const PRIMERA_MS = 5 * 60 * 1000;
const CERROJO = 'ai:quota:reconcile:lock';

interface Total extends Record<string, unknown> {
  workspace_id: string;
  provider: AiProvider;
  tokens: string;
}

/**
 * Cuadra los contadores de cupo con el registro de invocaciones (AR5, §9.3).
 *
 * Es lo que convierte tener el contador en Redis en una decisión segura en lugar
 * de en una apuesta. Si un proceso muere entre llamar al modelo y liquidar, el
 * gasto queda en la tabla y no en el contador: nadie lo nota —el cupo
 * simplemente rinde de más— hasta que alguien cuadra el mes. Esto lo cuadra.
 */
@Injectable()
export class AiQuotaReconcile implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AiQuotaReconcile.name);
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    private readonly quota: AiQuotaService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.temporizador = setInterval(() => void this.conciliar(), CADA_MS);
    this.temporizador.unref();

    const primera = setTimeout(() => void this.conciliar(), PRIMERA_MS);
    primera.unref();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** Concilia el mes en curso. Devuelve cuántos tokens de desfase se corrigieron. */
  async conciliar(now = Date.now()): Promise<number> {
    const tomado = await this.redis.set(CERROJO, '1', 'EX', 600, 'NX').catch(() => null);
    if (tomado === null) return 0;

    try {
      const inicio = `${AiQuotaService.month(now)}-01T00:00:00.000Z`;
      const totales = await this.db.execute<Total>(
        sql`SELECT * FROM ai_quota_month_totals(${inicio}::timestamptz)`,
      );

      let corregido = 0;
      for (const total of totales.rows) {
        corregido += await this.quota.reconcile(
          { workspaceId: total.workspace_id, provider: total.provider },
          Number(total.tokens),
          now,
        );
      }

      if (corregido > 0) {
        /*
         * Que haya desfase no es un fallo del que haya que alarmarse, pero sí
         * algo que conviene ver: si crece, es que se están perdiendo
         * liquidaciones y hay que mirar por qué.
         */
        this.logger.log(`Cupos conciliados: ${String(corregido)} tokens de desfase corregidos`);
      }
      return corregido;
    } catch (error) {
      this.logger.error({ err: error }, 'La conciliación de cupos falló');
      return 0;
    } finally {
      await this.redis.del(CERROJO).catch(() => undefined);
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Database } from '@app-foundry/db';

import { DATABASE, REDIS } from '../infrastructure/tokens.js';

export interface DependencyCheck {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  checks: Record<string, DependencyCheck>;
}

/**
 * Comprobaciones de salud escritas a mano, sin Terminus.
 *
 * Son dos consultas triviales y así controlamos exactamente qué se comprueba y
 * qué se responde, sin arrastrar una dependencia que además va una versión
 * mayor por detrás de Nest 12.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async check(): Promise<ReadinessReport> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    const checks = { postgres, redis };
    const status = Object.values(checks).every((c) => c.status === 'up') ? 'ok' : 'degraded';
    return { status, checks };
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    return this.time(async () => {
      await this.db.execute(sql`SELECT 1`);
    });
  }

  private async checkRedis(): Promise<DependencyCheck> {
    return this.time(async () => {
      await this.redis.ping();
    });
  }

  /**
   * Mide y captura. Un fallo de dependencia se reporta, no se propaga: el
   * endpoint de salud debe responder siempre, y decir qué está mal es
   * justamente su trabajo.
   */
  private async time(probe: () => Promise<void>): Promise<DependencyCheck> {
    const started = performance.now();
    try {
      await probe();
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Comprobación de salud fallida: ${message}`);
      return { status: 'down', latencyMs: Math.round(performance.now() - started), error: message };
    }
  }
}

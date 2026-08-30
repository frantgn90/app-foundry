import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Database } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';

import { DATABASE, ENV, REDIS } from '../infrastructure/tokens.js';

export interface ValidSession {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

const CACHE_PREFIX = 'sess:';
/**
 * Corto a propósito, pero ya no es lo único que sostiene la revocación: al
 * desactivar una cuenta, sus entradas se sueltan una a una (`dropCached`).
 */
const CACHE_TTL_SECONDS = 30;

/**
 * Sesiones opacas respaldadas por la base de datos.
 *
 * La cookie no lleva datos, solo un identificador aleatorio; de él se guarda
 * únicamente su SHA-256, así que quien lea la tabla no puede suplantar a nadie.
 * Es lo que permite cumplir RF-110: desactivar una cuenta borra sus sesiones y
 * el acceso cae de inmediato, algo que un JWT no permite sin reinventar esta
 * misma tabla.
 *
 * Estas operaciones ocurren **antes** de que exista identidad, así que pasan por
 * funciones acotadas de la base de datos y no por las políticas normales.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Devuelve el token en claro: es la única vez que existe fuera del navegador. */
  async create(userId: string, ip: string | null, userAgent: string | null): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_DAYS * 86_400_000);

    await this.db.execute(
      sql`SELECT auth_create_session(${userId}::uuid, ${this.hash(token)}::bytea,
                                     ${expiresAt.toISOString()}::timestamptz,
                                     ${ip}::inet, ${userAgent}::text)`,
    );
    return token;
  }

  async validate(token: string): Promise<ValidSession | null> {
    const hash = this.hash(token);
    const key = CACHE_PREFIX + hash.toString('hex');

    const cached = await this.redis.get(key).catch(() => null);
    if (cached !== null) {
      const data = JSON.parse(cached) as {
        sessionId: string;
        userId: string;
        expiresAt: string;
      };
      return { ...data, expiresAt: new Date(data.expiresAt) };
    }

    const result = await this.db.execute<{
      session_id: string;
      user_id: string;
      expires_at: string;
    }>(sql`SELECT * FROM auth_find_session(${hash}::bytea)`);

    const row = result.rows[0];
    if (!row) return null;

    const session: ValidSession = {
      sessionId: row.session_id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at),
    };
    await this.redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(session)).catch(() => null);
    return session;
  }

  async revoke(token: string): Promise<void> {
    const hash = this.hash(token);
    await this.db.execute(sql`SELECT auth_revoke_session(${hash}::bytea)`);
    await this.redis.del(CACHE_PREFIX + hash.toString('hex')).catch(() => null);
  }

  /**
   * Suelta de la caché las sesiones que ya se han borrado de la base de datos.
   *
   * Las filas las borra quien desactiva la cuenta, en su misma transacción, y
   * esa operación devuelve los hashes: son los que hacen falta aquí, porque la
   * caché va indexada por ellos y no se pueden reconstruir desde el token.
   *
   * Sin esto, quien acaba de ser desactivado seguiría entrando durante la vida
   * de lo cacheado, y «desactivar» pasaría a significar «dentro de un rato»,
   * que no es lo que dice RF-203.
   */
  async dropCached(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;
    await this.redis.del(...hashes.map((h) => CACHE_PREFIX + h)).catch(() => null);
  }

  /** SHA-256 del token: en la base de datos nunca hay nada reutilizable. */
  private hash(token: string): Buffer {
    return createHash('sha256').update(token).digest();
  }
}

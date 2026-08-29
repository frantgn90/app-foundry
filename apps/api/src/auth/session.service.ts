import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Database } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';

import { DATABASE, ENV, REDIS } from '../infrastructure/tokens.js';

export interface SesionValida {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

const PREFIJO_CACHE = 'sess:';
/** Corto a propósito: revocar debe notarse en segundos, no en minutos. */
const TTL_CACHE_SEGUNDOS = 30;

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
  async crear(userId: string, ip: string | null, userAgent: string | null): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expira = new Date(Date.now() + this.env.SESSION_TTL_DAYS * 86_400_000);

    await this.db.execute(
      sql`SELECT auth_create_session(${userId}::uuid, ${this.hash(token)}::bytea,
                                     ${expira.toISOString()}::timestamptz,
                                     ${ip}::inet, ${userAgent}::text)`,
    );
    return token;
  }

  async validar(token: string): Promise<SesionValida | null> {
    const hash = this.hash(token);
    const clave = PREFIJO_CACHE + hash.toString('hex');

    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado !== null) {
      const datos = JSON.parse(cacheado) as {
        sessionId: string;
        userId: string;
        expiresAt: string;
      };
      return { ...datos, expiresAt: new Date(datos.expiresAt) };
    }

    const resultado = await this.db.execute<{
      session_id: string;
      user_id: string;
      expires_at: string;
    }>(sql`SELECT * FROM auth_find_session(${hash}::bytea)`);

    const fila = resultado.rows[0];
    if (!fila) return null;

    const sesion: SesionValida = {
      sessionId: fila.session_id,
      userId: fila.user_id,
      expiresAt: new Date(fila.expires_at),
    };
    await this.redis.setex(clave, TTL_CACHE_SEGUNDOS, JSON.stringify(sesion)).catch(() => null);
    return sesion;
  }

  async revocar(token: string): Promise<void> {
    const hash = this.hash(token);
    await this.db.execute(sql`SELECT auth_revoke_session(${hash}::bytea)`);
    await this.redis.del(PREFIJO_CACHE + hash.toString('hex')).catch(() => null);
  }

  /** SHA-256 del token: en la base de datos nunca hay nada reutilizable. */
  private hash(token: string): Buffer {
    return createHash('sha256').update(token).digest();
  }
}

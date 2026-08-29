import { randomBytes } from 'node:crypto';

import type { Request } from 'express';
import type { Redis } from 'ioredis';
import type {
  Metadata,
  StateStore,
  StateStoreStoreCallback,
  StateStoreVerifyCallback,
} from 'passport-oauth2';

const PREFIJO = 'oauth:state:';
/** El usuario tiene diez minutos para completar el login en GitHub. */
const TTL_SEGUNDOS = 600;

/**
 * Almacén del parámetro `state` del flujo OAuth, en Redis.
 *
 * El `state` es lo que impide que alguien induzca a tu navegador a completar un
 * login que no iniciaste (RNF-105). `passport-oauth2` lo guarda por defecto en
 * la sesión de Express, pero aquí no hay sesión de Express: la nuestra es una
 * cookie opaca propia. Con Redis, además, el `state` funciona igual con varias
 * instancias de la API.
 *
 * Es de un solo uso: al verificarlo se borra, de modo que un `state` capturado
 * no sirve dos veces.
 */
export class RedisStateStore implements StateStore {
  constructor(private readonly redis: Redis) {}

  store(req: Request, callback: StateStoreStoreCallback): void;
  store(req: Request, meta: Metadata, callback: StateStoreStoreCallback): void;
  store(
    _req: Request,
    metaOCallback: Metadata | StateStoreStoreCallback,
    quizaCallback?: StateStoreStoreCallback,
  ): void {
    const callback = (quizaCallback ?? metaOCallback) as StateStoreStoreCallback;
    const state = randomBytes(24).toString('base64url');
    this.redis
      .setex(PREFIJO + state, TTL_SEGUNDOS, '1')
      .then(() => {
        callback(null, state);
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error('No se pudo guardar el state'), null);
      });
  }

  verify(req: Request, state: string, callback: StateStoreVerifyCallback): void;
  verify(req: Request, state: string, meta: Metadata, callback: StateStoreVerifyCallback): void;
  verify(
    _req: Request,
    state: string,
    metaOCallback: Metadata | StateStoreVerifyCallback,
    quizaCallback?: StateStoreVerifyCallback,
  ): void {
    const callback = (quizaCallback ?? metaOCallback) as StateStoreVerifyCallback;
    // DEL devuelve cuántas claves borró: si es 1, el state existía y era este.
    this.redis
      .del(PREFIJO + state)
      .then((borradas) => {
        if (borradas === 1) {
          callback(null, true, state);
        } else {
          callback(null, false, { message: 'El parámetro state no es válido o ha caducado' });
        }
      })
      .catch((error: unknown) => {
        callback(
          error instanceof Error ? error : new Error('No se pudo verificar el state'),
          false,
          null,
        );
      });
  }
}

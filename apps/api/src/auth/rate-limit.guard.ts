import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

import { REDIS } from '../infrastructure/tokens.js';

/**
 * Límite de tasa para los endpoints sensibles (RNF-109).
 *
 * Con registro abierto, el alta y el login son la superficie más expuesta de la
 * plataforma: sin límite, cualquiera puede crear cuentas en bucle o probar
 * tokens de sesión a ciegas.
 *
 * Se usa `rate-limiter-flexible` y no `@nestjs/throttler` porque este último aún
 * no soporta Nest 12. La cuenta vive en Redis, así que el límite es real aunque
 * haya varias instancias de la API: contarlo en memoria de proceso sería
 * multiplicar el límite por el número de réplicas.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limitador: RateLimiterRedis;

  constructor(@Inject(REDIS) redis: Redis) {
    this.limitador = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:auth',
      points: 20,
      duration: 60,
      blockDuration: 60,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const clave = request.ip ?? 'desconocida';

    try {
      await this.limitador.consume(clave);
      return true;
    } catch (resultado) {
      // La librería rechaza con el estado del límite, no con un Error.
      const espera =
        typeof resultado === 'object' && resultado !== null && 'msBeforeNext' in resultado
          ? Math.ceil(Number(resultado.msBeforeNext) / 1000)
          : 60;
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Demasiados intentos. Inténtalo de nuevo en unos segundos.',
          retryAfter: espera,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

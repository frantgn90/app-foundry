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
  private readonly limiter: RateLimiterRedis;

  constructor(@Inject(REDIS) redis: Redis) {
    this.limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:auth',
      points: 20,
      duration: 60,
      blockDuration: 60,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.ip ?? 'unknown';

    try {
      await this.limiter.consume(key);
      return true;
    } catch (result) {
      // La librería rechaza con el estado del límite, no con un Error.
      const retryAfter =
        typeof result === 'object' && result !== null && 'msBeforeNext' in result
          ? Math.ceil(Number(result.msBeforeNext) / 1000)
          : 60;
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many attempts. Try again in a few seconds.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC } from './public.decorator.js';
import { SessionService } from './session.service.js';

export const SESSION_COOKIE = 'foundry_session';

/**
 * Lo único que el guard sabe de quien pide: su identificador.
 *
 * Deliberadamente no es el usuario completo. Cargarlo costaría una consulta en
 * cada petición para algo que casi ningún endpoint necesita; quien lo necesite
 * lo pide explícitamente.
 */
export interface AuthenticatedRequest {
  id: string;
}

/**
 * Exige sesión válida en toda la aplicación (RF-109).
 *
 * Se registra como guard global y las excepciones se marcan una a una con
 * `@Publico()`. Al revés —proteger ruta por ruta— cualquier endpoint nuevo
 * nacería desprotegido, que es exactamente el error que no queremos poder
 * cometer.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publico) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedRequest }>();
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Not signed in');

    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException('Session is invalid or expired');

    // El guard corre antes que el interceptor de transacción, que leerá este
    // identificador para fijar la identidad en la base de datos.
    request.user = { id: session.userId };
    return true;
  }
}

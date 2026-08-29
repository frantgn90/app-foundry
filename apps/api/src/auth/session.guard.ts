import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ES_PUBLICO } from './public.decorator.js';
import { SessionService } from './session.service.js';

export const COOKIE_SESION = 'foundry_session';

/**
 * Lo único que el guard sabe de quien pide: su identificador.
 *
 * Deliberadamente no es el usuario completo. Cargarlo costaría una consulta en
 * cada petición para algo que casi ningún endpoint necesita; quien lo necesite
 * lo pide explícitamente.
 */
export interface PeticionAutenticada {
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
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publico) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: PeticionAutenticada }>();
    const token = (request.cookies as Record<string, string> | undefined)?.[COOKIE_SESION];
    if (!token) throw new UnauthorizedException('No hay sesión');

    const sesion = await this.sessions.validar(token);
    if (!sesion) throw new UnauthorizedException('La sesión no es válida o ha caducado');

    // El guard corre antes que el interceptor de transacción, que leerá este
    // identificador para fijar la identidad en la base de datos.
    request.user = { id: sesion.userId };
    return true;
  }
}

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { UsuarioAutenticado } from './auth.service.js';

/** Usuario de la petición, ya validado por el guard de sesión. */
export const UsuarioActual = createParamDecorator(
  (_datos: unknown, context: ExecutionContext): UsuarioAutenticado => {
    const request = context.switchToHttp().getRequest<{ user: UsuarioAutenticado }>();
    return request.user;
  },
);

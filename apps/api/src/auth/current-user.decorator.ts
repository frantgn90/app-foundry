import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from './session.guard.js';

/**
 * Identificador del usuario de la petición, ya validado por el guard.
 *
 * Devuelve solo el id, que es lo que el guard ha comprobado. Un decorador que
 * prometiera el usuario completo obligaría a cargarlo siempre, o a mentir.
 */
export const CurrentUserId = createParamDecorator(
  (_datos: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedRequest }>();
    return request.user.id;
  },
);

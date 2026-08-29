import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'es_publico';

/**
 * Marca una ruta como accesible sin sesión.
 *
 * Solo deberían llevarlo el inicio del flujo OAuth, su callback y las
 * comprobaciones de salud.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

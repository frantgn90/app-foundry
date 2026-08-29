import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'es_publico';

/**
 * Marca una ruta como accesible sin sesión.
 *
 * Solo deberían llevarlo el inicio del flujo OAuth, su callback y las
 * comprobaciones de salud.
 */
export const Publico = (): MethodDecorator & ClassDecorator => SetMetadata(ES_PUBLICO, true);

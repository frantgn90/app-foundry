import { SetMetadata } from '@nestjs/common';

export const SIN_TRANSACCION = 'sin-transaccion';

/**
 * Marca una ruta que no debe correr dentro de la transacción de la petición.
 *
 * Existe por el canal de avisos: una conexión SSE dura lo que dure la pestaña
 * abierta, y como el interceptor abre una transacción por petición, cada persona
 * conectada retendría una conexión del pool durante horas. Con unas pocas se
 * agota el pool, y de paso una transacción tan larga impide limpiar filas
 * muertas en toda la base de datos.
 *
 * Lo que se marque así se queda sin identidad en la sesión de base de datos, así
 * que no puede consultar sin más: si necesita hacerlo, abre su propia
 * transacción corta con `conIdentidad`.
 */
export const SinTransaccion = (): MethodDecorator => SetMetadata(SIN_TRANSACCION, true);

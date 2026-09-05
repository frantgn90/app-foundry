/**
 * Lo que el emisor mide.
 *
 * Un puerto y no el servicio de métricas de la API, por lo mismo que en el
 * runtime de IA: aquí hace falta una llamada, y depender del servicio entero
 * traería el registro de todas las métricas del producto a un paquete que solo
 * emite una.
 */
export interface NotificationMetricsPort {
  avisosEmitidos(cuantos: number): void;
}

export const NOTIFICATION_METRICS = Symbol('NOTIFICATION_METRICS');

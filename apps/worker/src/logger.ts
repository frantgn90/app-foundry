import { pino, type Logger } from 'pino';

/**
 * El registro del worker.
 *
 * Más escueto que el de la API a propósito: aquí no hay peticiones, hay
 * trabajos, y lo que interesa de cada uno es qué agente, en qué hilo y cómo
 * acabó. **Nunca el contenido** —ni el documento, ni el comentario, ni el
 * prompt— por lo mismo que en las trazas (RNF-801, RNF-112).
 */
export function createWorkerLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    ...(pretty && { transport: { target: 'pino-pretty' } }),
    base: { service: 'worker' },
  });
}

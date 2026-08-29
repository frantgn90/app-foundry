import { AsyncLocalStorage } from 'node:async_hooks';

import type { Transaction } from '@app-foundry/db';

export interface RequestContext {
  /** Transacción de la petición; todas las consultas deben usarla. */
  tx: Transaction;
  /** Identidad fijada en la sesión de base de datos, o null si no hay. */
  userId: string | null;
}

/**
 * Contexto de la petición en curso.
 *
 * Se usa AsyncLocalStorage y no providers request-scoped de Nest: estos
 * reinstancian el árbol de dependencias en cada petición y penalizan latencia y
 * memoria sin aportar nada aquí (TRD §6.2).
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Transacción de la petición en curso.
 *
 * Si esto lanza, es que alguien intenta consultar fuera del interceptor: sería
 * una consulta sin identidad y, por tanto, sin políticas aplicadas a la
 * identidad correcta. Mejor un error ruidoso que una consulta silenciosa.
 */
export function currentTx(): Transaction {
  const ctx = requestContext.getStore();
  if (!ctx) {
    throw new Error(
      'No hay contexto de petición: toda consulta debe ejecutarse dentro del interceptor de transacción',
    );
  }
  return ctx.tx;
}

export function currentUserId(): string | null {
  return requestContext.getStore()?.userId ?? null;
}

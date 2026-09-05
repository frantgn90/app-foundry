import { AsyncLocalStorage } from 'node:async_hooks';

import type { Transaction } from '@app-foundry/db';

export interface RequestContext {
  /** Transacción de la petición; todas las consultas deben usarla. */
  tx: Transaction;
  /** Identidad fijada en la sesión de base de datos, o null si no hay. */
  userId: string | null;
  /** Efectos que solo deben ocurrir si la transacción sale adelante. */
  trasCommit: (() => Promise<void>)[];
}

/**
 * Contexto de la transacción en curso.
 *
 * Se usa AsyncLocalStorage y no providers request-scoped de Nest: estos
 * reinstancian el árbol de dependencias en cada petición y penalizan latencia y
 * memoria sin aportar nada aquí (TRD §6.2).
 *
 * Vive aquí y no en la API porque no es solo de las peticiones: el worker
 * también abre transacciones con identidad y consulta dentro de ellas, y todo
 * lo que se movió a este paquete lo hace a través de `currentTx()`. Si el
 * almacén viviera en `apps/api`, el worker tendría el suyo propio y las
 * consultas del paso común de invocación no encontrarían ninguno.
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

/**
 * Aplaza algo hasta que la transacción haya salido adelante.
 *
 * Es para lo que sale del sistema y no se puede deshacer: avisar por el canal en
 * tiempo real, por ejemplo. Publicado dentro de la transacción, un aviso podría
 * llegar al navegador de alguien y desaparecer un instante después al fallar el
 * guardado, dejándole mirando algo que no existe.
 *
 * Fuera de una petición no hay nada que esperar, así que se ejecuta y ya está.
 */
export function trasCommit(efecto: () => Promise<void>): void {
  const ctx = requestContext.getStore();
  if (!ctx) {
    void efecto();
    return;
  }
  ctx.trasCommit.push(efecto);
}

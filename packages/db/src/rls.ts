import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/** Handle de transacción de Drizzle: mismo API que la base de datos. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Ejecuta una función con la identidad del usuario fijada, dentro de una
 * transacción.
 *
 * Es la pieza que conecta la sesión HTTP con la Row-Level Security: mientras
 * dure la transacción, `current_app_user()` devuelve este usuario y las
 * políticas se aplican solas.
 *
 * `set_config(..., true)` es **local a la transacción**. Ese `true` es lo que
 * impide que una conexión devuelta al pool conserve la identidad del usuario
 * anterior, que sería una fuga de datos silenciosa y difícil de reproducir.
 */
export async function withUserContext<T>(
  db: Database,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Ejecuta sin identidad.
 *
 * Como las políticas comparan contra `current_app_user()` y este devuelve NULL,
 * aquí no se ve ninguna fila: es el comportamiento correcto por defecto, no un
 * modo privilegiado.
 */
export async function withoutUserContext<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

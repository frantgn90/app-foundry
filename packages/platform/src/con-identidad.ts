import { sql } from 'drizzle-orm';

import type { Database } from '@app-foundry/db';

import { requestContext } from './tx-context.js';

/**
 * Abre una transacción corta con la identidad del usuario.
 *
 * Es lo mismo que hace el interceptor, pero a demanda, para lo que corre fuera
 * de una petición normal: el canal de avisos al reanudar, y las tareas de fondo.
 * Se usa en lugar de consultar sin identidad porque las políticas son la
 * seguridad de este sistema, no un adorno; una consulta sin identidad no ve nada
 * y disimula el error en vez de darlo.
 */
export async function conIdentidad<T>(
  db: Database,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return requestContext.run({ tx, userId, trasCommit: [] }, fn);
  });
}

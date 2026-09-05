import { sql } from 'drizzle-orm';

import type { Database } from '@app-foundry/db';

import { requestContext } from './tx-context.js';

/**
 * Abre una transacción corta con la identidad del usuario.
 *
 * Es lo mismo que hace el interceptor, pero a demanda, para lo que corre fuera
 * de una petición normal: el canal de avisos al reanudar, las tareas de fondo y
 * cada trabajo del worker. Se usa en lugar de consultar sin identidad porque las
 * políticas son la seguridad de este sistema, no un adorno; una consulta sin
 * identidad no ve nada y disimula el error en vez de darlo.
 */
export async function conIdentidad<T>(
  db: Database,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const pendientes: (() => Promise<void>)[] = [];

  const resultado = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return requestContext.run({ tx, userId, trasCommit: pendientes }, fn);
  });

  /*
   * Y los efectos aplazados, con la transacción ya confirmada.
   *
   * Esto faltaba: la lista se creaba y se tiraba, así que todo lo que se
   * apartaba con `trasCommit` —publicar un aviso por el canal en tiempo real,
   * sobre todo— no llegaba a ocurrir nunca fuera de una petición HTTP. El aviso
   * se escribía en la tabla y no se repartía, de modo que aparecía al recargar y
   * no al momento. Se vio mandando una mención desde la pantalla y esperando una
   * respuesta que estaba en la base de datos pero no en el navegador.
   *
   * Su fallo no se propaga, por lo mismo que en el interceptor: que un aviso no
   * salga no puede deshacer un trabajo que ya está guardado.
   */
  for (const efecto of pendientes) {
    try {
      await efecto();
    } catch {
      /* Ni siquiera se registra aquí: este paquete no conoce el log de nadie. */
    }
  }

  return resultado;
}

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/**
 * Crea el pool y el cliente de Drizzle.
 *
 * Se usa `pg` (node-postgres) y no `postgres.js` porque tiene instrumentación
 * automática de OpenTelemetry: cada consulta aparece como span dentro de la
 * traza de su petición, sin tocar el código (TRD §13).
 */
export function createDb(connectionString: string, max = 10): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max,
    // Una conexión colgada es peor que una que falla: preferimos el error.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

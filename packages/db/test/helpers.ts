import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';

import { createDb, type Database, type DbHandle, runMigrations } from '../src/index.js';

export interface TestDb extends DbHandle {
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

/**
 * Levanta un Postgres real y aplica las migraciones.
 *
 * Tiene que ser un Postgres de verdad: la Row-Level Security no se puede
 * simular con un doble, y un test que no la ejercite no prueba nada de lo que
 * importa (TRD §14).
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:18.6-alpine')
    .withDatabase('app_foundry')
    .withUsername('foundry_migrator')
    .withPassword('test')
    .start();

  const url = container.getConnectionUri();
  await runMigrations(url);

  const handle = createDb(url);
  return {
    ...handle,
    container,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

/**
 * Ejecuta como el rol de la aplicación y con la identidad indicada.
 *
 * `SET LOCAL ROLE` es lo que hace honesto al test: el rol que conecta
 * Testcontainers es superusuario y los superusuarios **siempre** ignoran RLS.
 * Sin este cambio de rol, todas las comprobaciones pasarían aunque las
 * políticas estuvieran mal escritas o directamente ausentes.
 */
export async function asAppUser<T>(
  db: Database,
  userId: string | null,
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    if (userId !== null) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    }
    return fn(tx);
  });
}

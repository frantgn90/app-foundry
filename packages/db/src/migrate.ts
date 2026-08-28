import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from './client.js';

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/**
 * Aplica las migraciones pendientes.
 *
 * Usa la URL del rol privilegiado: crear tablas, roles y políticas no es algo
 * que deba poder hacer el rol que atiende peticiones (TRD §6.1).
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, close } = createDb(connectionString, 1);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

// Ejecutable directamente:  pnpm db:migrate
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) {
    console.error('Falta DATABASE_MIGRATION_URL. Copia .env.example a .env y rellénalo.');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('Migraciones aplicadas.');
    })
    .catch((error: unknown) => {
      console.error('Las migraciones han fallado:', error);
      process.exit(1);
    });
}

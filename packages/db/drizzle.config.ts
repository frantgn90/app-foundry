import { defineConfig } from 'drizzle-kit';

/**
 * Las migraciones se aplican con el rol privilegiado, no con el de la
 * aplicación: crear tablas y políticas no es algo que deba poder hacer el rol
 * que atiende peticiones (TRD §6.1).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url:
      process.env['DATABASE_MIGRATION_URL'] ??
      'postgres://foundry_migrator:foundry_local_dev@localhost:5432/app_foundry',
  },
  strict: true,
  verbose: true,
});

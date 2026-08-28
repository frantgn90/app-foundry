import { customType } from 'drizzle-orm/pg-core';

/**
 * `citext`: texto que compara sin distinguir mayúsculas.
 *
 * Para emails y nombres de usuario de GitHub es lo correcto: `Ana@Example.com`
 * y `ana@example.com` son la misma persona, y `FranTgn90` el mismo handle. La
 * alternativa —guardar todo en minúsculas— compararía bien pero perdería la
 * forma en que cada uno escribe su nombre.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** `inet` de Postgres, que Drizzle no trae de serie. */
export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});

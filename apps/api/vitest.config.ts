import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Cada fichero levanta Postgres, Redis y la aplicación entera: descargar
    // imágenes y aplicar migraciones no cabe en los tiempos por defecto.
    testTimeout: 120_000,
    hookTimeout: 240_000,
    // Sin solaparse: los tests comparten un escenario y no deben competir.
    fileParallelism: false,
  },
});

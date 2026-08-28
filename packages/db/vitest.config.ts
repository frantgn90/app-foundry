import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Testcontainers arranca un Postgres real: descargar la imagen la primera
    // vez y aplicar migraciones no cabe en los 5 segundos por defecto.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Un contenedor por fichero, sin solaparse: más lento que en paralelo, pero
    // los tests de aislamiento no deben competir por el mismo estado.
    fileParallelism: false,
  },
});

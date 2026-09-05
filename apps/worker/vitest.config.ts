import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Postgres y Redis de verdad: descargar las imágenes la primera vez y
    // aplicar migraciones no cabe en los 5 segundos por defecto.
    testTimeout: 120_000,
    hookTimeout: 240_000,
    // Un juego de contenedores por fichero, sin solaparse: dos workers sobre la
    // misma cola se robarían los trabajos y las pruebas fallarían por turnos.
    fileParallelism: false,
  },
});

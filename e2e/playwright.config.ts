import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:4173';
const API = 'http://localhost:3001';

/**
 * Recorrido completo contra la aplicación de verdad.
 *
 * No levanta la base de datos ni Redis: usa los que ya están en marcha
 * (`pnpm infra:up`). Duplicarlos aquí significaría mantener dos formas de
 * levantar lo mismo, y la que se usa a diario es la otra.
 *
 * La interfaz se sirve compilada, no en modo desarrollo: es lo que se va a
 * desplegar, y un fallo que solo aparece al compilar —una importación que el
 * servidor de desarrollo resuelve y el empaquetado no— es justo el que conviene
 * que salte aquí y no después.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: WEB,
    // Solo se guarda rastro de lo que falla: en verde no hace falta y ocupa.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --import ./apps/api/dist/observability/telemetry.js apps/api/dist/main.js',
      cwd: '..',
      url: `${API}/health/ready`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      // Sin esto, un fallo al arrancar se ve como un tiempo agotado sin más.
      stdout: 'pipe',
      stderr: 'pipe',
      env: { OTEL_ENABLED: 'false' },
    },
    {
      command: 'pnpm --filter @app-foundry/web exec vite preview --port 4173 --strictPort',
      cwd: '..',
      url: WEB,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});

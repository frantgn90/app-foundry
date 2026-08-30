import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * A dónde van las llamadas que no son de la propia interfaz.
 *
 * La SPA habla con la API por el mismo origen: así las cookies de sesión se
 * comportan igual que lo harán en producción, sin sorpresas de SameSite al
 * desplegar. Las rutas de salud viven fuera de `/api/v1` porque un orquestador
 * las espera en la raíz; sin su entrada, Vite devolvería el index con un 200 y
 * el cliente recibiría HTML donde espera JSON.
 */
const reenvio = {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
  '/health': { target: 'http://localhost:3001', changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /*
   * El mismo reenvío para el servidor de desarrollo y para la vista previa de lo
   * compilado. `preview` tiene su propia configuración y no hereda la de
   * `server`: sin esto, servir la versión compilada en local deja las llamadas a
   * la API sin destino y la página aparece en blanco, que es exactamente lo que
   * le pasó a la prueba de extremo a extremo.
   *
   * En producción no hace falta: ahí lo reenvía el servidor web que sirve los
   * ficheros.
   */
  preview: {
    port: 4173,
    proxy: reenvio,
  },
  server: {
    port: 5173,
    // La SPA habla con la API por el mismo origen en desarrollo: así las
    // cookies de sesión se comportan igual que lo harán en producción, sin
    // sorpresas de SameSite al desplegar.
    proxy: reenvio,
  },
});

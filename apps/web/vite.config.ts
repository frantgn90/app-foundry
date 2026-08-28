import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // La SPA habla con la API por el mismo origen en desarrollo: así las
    // cookies de sesión se comportan igual que lo harán en producción, sin
    // sorpresas de SameSite al desplegar.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      // Las rutas de salud viven fuera de /api/v1 porque un orquestador las
      // espera en la raíz; sin esta entrada, Vite devolvería el index.html con
      // un 200 y el cliente recibiría HTML donde espera JSON.
      '/health': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});

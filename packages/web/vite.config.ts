import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the page is served by Vite and talks to a decker server on DECKER_PORT.
const api = `http://127.0.0.1:${process.env.DECKER_PORT ?? 4747}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    strictPort: false,
    proxy: { '/api': { target: api, ws: true, changeOrigin: false } },
  },
  preview: { port: 4173 },
});

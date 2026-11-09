import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiTarget = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.MINIAPP_PORT ?? 5173),
    strictPort: true,
    // The browser talks to /api/*; in production Caddy does the same rewrite (no CORS).
    proxy: { '/api': { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  preview: {
    port: Number(process.env.MINIAPP_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': { target: apiTarget, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  build: { manifest: true, target: 'es2022', sourcemap: false },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], globals: false },
});

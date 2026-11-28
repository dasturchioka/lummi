import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { tokenValue } from './tokens-css';

const apiTarget = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;
const proxy = { '/api': { target: apiTarget, rewrite: (p: string) => p.replace(/^\/api/, '') } };

/**
 * index.html paints the page ground before the stylesheet loads (no white flash on a dark
 * phone). The colours come from tokens.css, the one place they live, so they cannot drift.
 */
function tokensInHtml(): Plugin {
  return {
    name: 'lummi-tokens-in-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const css = readFileSync(new URL('./src/styles/tokens.css', import.meta.url), 'utf8');
        return html
          .replaceAll('%GROUND_LIGHT%', tokenValue(css, 'light', '--c-ground'))
          .replaceAll('%GROUND_DARK%', tokenValue(css, 'dark', '--c-ground'));
      },
    },
  };
}

/** Browser mode (a mocked Telegram) is for development only: a production build refuses it. */
function noBrowserModeInProduction(): Plugin {
  return {
    name: 'lummi-no-browser-mode-in-production',
    apply: 'build',
    config(_, { mode }) {
      if (mode === 'production' && process.env.VITE_BROWSER_MODE) {
        throw new Error('VITE_BROWSER_MODE must not be set for a production build (ADR 0030)');
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tokensInHtml(), noBrowserModeInProduction()],
  server: { port: Number(process.env.MINIAPP_PORT ?? 5173), strictPort: true, proxy },
  preview: { port: Number(process.env.MINIAPP_PORT ?? 5173), strictPort: true, proxy },
  build: { manifest: true, target: 'es2022', sourcemap: false },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    setupFiles: ['src/test/setup.ts'],
    // a test may wait on several findBy* of asyncUtilTimeout (5 s) each; 5 s would end it first under load
    testTimeout: 15_000,
  },
});

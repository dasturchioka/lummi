import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // CI runs on the low-priority runner on the shared staging VPS (#72): the first jsdom test of a
  // file pays the whole render path, which can pass 5 s there. Locally the default stays.
  test: { testTimeout: process.env.CI ? 20_000 : 5_000 },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Lean on a 7 GB shared machine. Every test uses fakes: no Telegram, no API, no database.
    maxWorkers: 2,
    include: ['test/**/*.unit.test.ts'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Lean on a 7 GB shared machine: few workers; the integration project shares one Postgres.
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/**/*.unit.test.ts', 'src/**/*.unit.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          globalSetup: ['test/harness/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});

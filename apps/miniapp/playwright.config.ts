import { defineConfig, devices } from '@playwright/test';

/**
 * Seam 3 of ADR 0028 (ticket #34): one happy-path test in a browser. `npm run e2e` starts the same
 * disposable stack the screenshot run uses (e2e/global-setup.ts) and tears it down afterwards.
 */
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0, // a flake must show up, not be retried away
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Pixel 7'],
    locale: 'ru-RU',
    timezoneId: 'Asia/Tashkent',
    trace: 'retain-on-failure',
  },
});

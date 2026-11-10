import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

it('answers /health with the database reachable, no sign-in needed', async () => {
  const res = await fetch(`${t.baseUrl}/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

it('answers 503 when the database is down', async () => {
  // a second app over a closed pool cannot be built cheaply; the check itself is the unit under test
  const { HealthController } = await import('../src/health/health.controller');
  const broken = new HealthController({
    execute: () => Promise.reject(new Error('connection refused')),
  } as never);
  await expect(broken.check()).rejects.toMatchObject({ status: 503 });
});

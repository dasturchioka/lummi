import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { auditLog } from '@lummi/db';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

it('starts light and saves language and theme per customer', async () => {
  const { client } = await t.signIn({ id: 21, first_name: 'Ali', language_code: 'ru' });
  const me = await client.me.get();
  expect(me.status === 200 && me.body.theme).toBe('light');

  const res = await client.me.updatePreferences({ body: { theme: 'dark', language: 'uz' } });
  expect(res.status === 200 && res.body).toMatchObject({ theme: 'dark', language: 'uz' });

  // a later sign-in (new launch) keeps the saved choice, not language_code
  const again = await t.signIn({ id: 21, first_name: 'Ali', language_code: 'ru' });
  const me2 = await again.client.me.get();
  expect(me2.status === 200 && me2.body).toMatchObject({ theme: 'dark', language: 'uz' });

  const audit = await t.db.select().from(auditLog);
  expect(audit.map((a) => a.action)).toContain('customer.preferences_changed');
});

it('rejects an empty change and an anonymous caller', async () => {
  const { token } = await t.signIn();
  const empty = await fetch(`${t.baseUrl}/me/preferences`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(empty.status).toBe(400);
  const anon = await t.client.me.updatePreferences({ body: { theme: 'dark' } });
  expect(anon.status).toBe(401);
});

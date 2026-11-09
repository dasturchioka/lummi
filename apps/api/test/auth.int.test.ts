import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, customers } from '@lummi/db';
import { signInitData } from './harness/sign-init-data';
import { TEST_BOT_TOKEN, createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const nowSec = () => Math.floor(t.edges.clock.now().getTime() / 1000);

describe('POST /auth/telegram', () => {
  it('creates the customer on first sign-in and returns a session that /me accepts', async () => {
    const res = await t.client.auth.telegram({
      body: { initData: t.initData({ id: 7, first_name: 'Ali', language_code: 'uz' }) },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const me = await t.client.me.get({
      extraHeaders: { authorization: `Bearer ${res.body.token}` },
    });
    if (me.status !== 200) throw new Error('me failed');
    expect(me.body).toMatchObject({ telegramId: 7, firstName: 'Ali', language: 'uz' });
    expect(await t.db.select().from(customers)).toHaveLength(1);
    const audit = await t.db.select().from(auditLog);
    expect(audit.map((a) => a.action)).toEqual(['customer.created']);
    expect(audit[0]).toMatchObject({ actorType: 'customer', actorId: me.body.id });
  });

  it('defaults language to RU unless language_code is uz', async () => {
    for (const [id, code, expected] of [
      [1, 'ru', 'ru'],
      [2, 'en', 'ru'],
      [3, undefined, 'ru'],
      [4, 'uz', 'uz'],
    ] as const) {
      const { client } = await t.signIn({ id, first_name: 'X', language_code: code });
      const me = await client.me.get();
      expect(me.status === 200 && me.body.language).toBe(expected);
    }
  });

  it('a second sign-in reuses the customer and keeps the chosen language', async () => {
    const first = await t.signIn({ id: 9, first_name: 'Old', language_code: 'uz' });
    const second = await t.signIn({ id: 9, first_name: 'New', language_code: 'ru' });
    const a = await first.client.me.get();
    const b = await second.client.me.get();
    expect(a.status === 200 && b.status === 200 && a.body.id === b.body.id).toBe(true);
    expect(b.status === 200 && b.body).toMatchObject({ firstName: 'New', language: 'uz' });
    expect(await t.db.select().from(customers)).toHaveLength(1);
  });

  it('rejects forged, stale, future-dated and duplicate-field initData with 401', async () => {
    const forged = signInitData({ botToken: 'other:token', authDate: nowSec() });
    const stale = signInitData({ botToken: TEST_BOT_TOKEN, authDate: nowSec() - 3600 });
    const future = signInitData({ botToken: TEST_BOT_TOKEN, authDate: nowSec() + 3600 });
    const dup = signInitData({
      botToken: TEST_BOT_TOKEN,
      authDate: nowSec(),
      unsignedSuffix: [['auth_date', '1']],
    });
    const expected = [
      [forged, 'invalid_init_data'],
      [stale, 'expired_init_data'],
      [future, 'expired_init_data'],
      [dup, 'invalid_init_data'],
    ] as const;
    for (const [initData, code] of expected) {
      const res = await t.client.auth.telegram({ body: { initData } });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code });
    }
    expect(await t.db.select().from(customers)).toHaveLength(0);
  });

  it('the freshness window is a setting', async () => {
    const old = t.initData(undefined, { authDate: nowSec() - 3600 });
    expect((await t.client.auth.telegram({ body: { initData: old } })).status).toBe(401);
    // settings are changed through SettingsService only; here via the same function the admin will use
    const { SettingsService } = await import('../src/settings/settings.service');
    const { AuditService } = await import('../src/audit/audit.service');
    await new SettingsService(t.db, new AuditService()).set('auth.initDataMaxAgeSeconds', 7200, {
      type: 'system',
    });
    expect((await t.client.auth.telegram({ body: { initData: old } })).status).toBe(200);
  });
});

describe('session', () => {
  it('requires a valid bearer session for /me', async () => {
    expect((await t.client.me.get()).status).toBe(401);
    expect(
      (await t.client.me.get({ extraHeaders: { authorization: 'Bearer nonsense' } })).status,
    ).toBe(401);
  });

  it('expires after the session TTL', async () => {
    const { client } = await t.signIn();
    expect((await client.me.get()).status).toBe(200);
    t.edges.clock.advance(3601 * 1000);
    expect((await client.me.get()).status).toBe(401);
  });

  it('identity comes only from the session: a client-supplied user id is ignored', async () => {
    const a = await t.signIn({ id: 1, first_name: 'A' });
    await t.signIn({ id: 2, first_name: 'B' });
    const res = await fetch(`${t.baseUrl}/me?userId=2&customerId=2`, {
      headers: { authorization: `Bearer ${a.token}`, 'x-user-id': '2' },
    });
    expect(((await res.json()) as { firstName: string }).firstName).toBe('A');
  });
});

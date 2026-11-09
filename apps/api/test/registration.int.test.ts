import { auditLog, customers, eq } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signContact } from './harness/sign-contact';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const ali = { id: 31, first_name: 'Ali', language_code: 'ru' };
const vali = { id: 32, first_name: 'Vali', language_code: 'uz' };
const nowSec = () => Math.floor(t.edges.clock.now().getTime() / 1000);
const contact = (over: Partial<Parameters<typeof signContact>[0]> = {}) =>
  signContact({
    botToken: TEST_BOT_TOKEN,
    userId: ali.id,
    phone: '998901234567',
    authDate: nowSec(),
    ...over,
  });
const actions = async () => (await t.db.select().from(auditLog)).map((a) => a.action);

describe('share contact', () => {
  it('a customer starts without a phone and can still use the API', async () => {
    const { client } = await t.signIn(ali);
    const me = await client.me.get();
    expect(me.status === 200 && me.body).toMatchObject({ phone: null, writeAccess: null });
  });

  it('sets the account phone from a verified contact of the signed-in user', async () => {
    const { client } = await t.signIn(ali);
    const res = await client.me.shareContact({ body: { proof: contact() } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.customer.phone).toBe('+998901234567');
    expect(res.body.session).toBeNull();
    expect(await actions()).toContain('customer.phone_set');
    const me = await client.me.get();
    expect(me.status === 200 && me.body.phone).toBe('+998901234567');
  });

  it('rejects a forged contact: wrong signature, edited phone, unsigned, other bot', async () => {
    const { client } = await t.signIn(ali);
    const good = contact();
    const edited = good.replace('998901234567', '998909999999');
    const unsigned = new URLSearchParams(good);
    unsigned.delete('hash');
    const otherBot = signContact({
      botToken: '999:other-bot',
      userId: ali.id,
      phone: '998901234567',
      authDate: nowSec(),
    });
    for (const proof of [edited, unsigned.toString(), otherBot, 'phone=%2B998901234567', 'x']) {
      const res = await client.me.shareContact({ body: { proof } });
      expect(res.status).toBe(400);
      if (res.status === 400) expect(res.body.code).toBe('invalid_contact');
    }
    const me = await client.me.get();
    expect(me.status === 200 && me.body.phone).toBeNull();
  });

  it('rejects a bare phone sent in the body', async () => {
    const { token } = await t.signIn(ali);
    const res = await fetch(`${t.baseUrl}/me/contact`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+998901234567' }),
    });
    expect(res.status).toBe(400);
    const [c] = await t.db.select().from(customers).where(eq(customers.telegramId, ali.id));
    expect(c?.phone).toBeNull();
  });

  it("rejects another user's genuine, signed contact", async () => {
    const { client } = await t.signIn(ali);
    const valisContact = signContact({
      botToken: TEST_BOT_TOKEN,
      userId: vali.id,
      phone: '998935550000',
      authDate: nowSec(),
    });
    const res = await client.me.shareContact({ body: { proof: valisContact } });
    expect(res.status).toBe(403);
    if (res.status === 403) expect(res.body.code).toBe('contact_not_yours');
    const [c] = await t.db.select().from(customers).where(eq(customers.telegramId, ali.id));
    expect(c?.phone).toBeNull();
  });

  it('rejects a stale contact', async () => {
    const { client } = await t.signIn(ali);
    const res = await client.me.shareContact({
      body: { proof: contact({ authDate: nowSec() - 7 * 24 * 3600 }) },
    });
    expect(res.status).toBe(400);
    if (res.status === 400) expect(res.body.code).toBe('expired_contact');
  });

  it('needs a session', async () => {
    const res = await t.client.me.shareContact({ body: { proof: contact() } });
    expect(res.status).toBe(401);
  });

  it('relinks the customer who held the phone to the new Telegram id, and audits it', async () => {
    // the old account has history; the person now opens the app from a new Telegram account
    const old = await t.signIn(ali);
    await old.client.me.updatePreferences({ body: { theme: 'dark' } });
    await old.client.me.shareContact({ body: { proof: contact() } });
    const [oldRow] = await t.db.select().from(customers).where(eq(customers.telegramId, ali.id));

    const fresh = await t.signIn(vali);
    const res = await fresh.client.me.shareContact({
      body: {
        proof: contact({ userId: vali.id }),
      },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.customer).toMatchObject({
      id: oldRow!.id,
      telegramId: vali.id,
      phone: '+998901234567',
      theme: 'dark',
    });
    expect(res.body.session).not.toBeNull();

    const rows = await t.db.select().from(customers);
    expect(rows).toHaveLength(1);
    const relink = (await t.db.select().from(auditLog)).find(
      (a) => a.action === 'customer.relinked',
    );
    expect(relink).toMatchObject({
      actorId: oldRow!.id,
      targetId: String(oldRow!.id),
      payload: { fromTelegramId: ali.id, toTelegramId: vali.id },
    });

    // the new session belongs to the relinked customer
    const { initClient } = await import('@ts-rest/core');
    const { apiContract } = await import('@lummi/contracts');
    const client = initClient(apiContract, {
      baseUrl: t.baseUrl,
      baseHeaders: { authorization: `Bearer ${res.body.session!.token}` },
      throwOnUnknownStatus: true,
    });
    const me = await client.me.get();
    expect(me.status === 200 && me.body.id).toBe(oldRow!.id);

    // and a later launch from the new account lands on the same record
    const again = await t.signIn(vali);
    const me2 = await again.client.me.get();
    expect(me2.status === 200 && me2.body).toMatchObject({
      id: oldRow!.id,
      phone: '+998901234567',
    });
  });

  it('keeps the phone unique: two customers never share one', async () => {
    const a = await t.signIn(ali);
    await a.client.me.shareContact({ body: { proof: contact() } });
    const b = await t.signIn(vali);
    await b.client.me.shareContact({ body: { proof: contact({ userId: vali.id }) } });
    const withPhone = (await t.db.select().from(customers)).filter((c) => c.phone);
    expect(withPhone).toHaveLength(1);
  });
});

describe('write access', () => {
  it('records a refusal, flags the customer, audits it, and does not block anything', async () => {
    const { client } = await t.signIn(ali);
    const res = await client.me.writeAccess({ body: { allowed: false } });
    expect(res.status === 200 && res.body.writeAccess).toBe('refused');
    const [c] = await t.db.select().from(customers);
    expect(c?.botBlocked).toBe(true);
    expect(await actions()).toContain('customer.write_access_refused');
    const me = await client.me.get();
    expect(me.status).toBe(200);
  });

  it('records a grant and clears the flag', async () => {
    const { client } = await t.signIn(ali);
    await client.me.writeAccess({ body: { allowed: false } });
    const res = await client.me.writeAccess({ body: { allowed: true } });
    expect(res.status === 200 && res.body.writeAccess).toBe('granted');
    const [c] = await t.db.select().from(customers);
    expect(c?.botBlocked).toBe(false);
  });
});

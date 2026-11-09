import { auditLog, customers, eq } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiContract } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { initClient } from '@ts-rest/core';
import { OutboxService } from '../src/outbox/outbox.service';
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

    // the OLD Telegram account's session no longer reaches this customer: not /me, not refresh
    expect((await old.client.me.get()).status).toBe(401);
    expect((await old.client.auth.refresh()).status).toBe(401);

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

describe('relink safety', () => {
  it('never absorbs a customer that already has a phone: 409 phone_taken, nothing changes', async () => {
    const old = await t.signIn(ali);
    await old.client.me.shareContact({ body: { proof: contact() } });
    const other = await t.signIn(vali);
    await other.client.me.shareContact({
      body: { proof: contact({ userId: vali.id, phone: '998935550000' }) },
    });
    // vali's Telegram account now claims ali's number
    const res = await other.client.me.shareContact({
      body: { proof: contact({ userId: vali.id }) },
    });
    expect(res.status).toBe(409);
    if (res.status === 409) expect(res.body.code).toBe('phone_taken');
    const rows = await t.db.select().from(customers);
    expect(rows.map((r) => [r.telegramId, r.phone]).sort()).toEqual([
      [ali.id, '+998901234567'],
      [vali.id, '+998935550000'],
    ]);
    expect((await other.client.me.get()).status).toBe(200);
  });

  it('the relinked customer takes the new account chat state, not the old one', async () => {
    const old = await t.signIn(ali);
    await old.client.me.shareContact({ body: { proof: contact() } });
    await t.db.update(customers).set({ botBlocked: true, writeAccess: 'granted' });
    const fresh = await t.signIn(vali);
    await fresh.client.me.writeAccess({ body: { allowed: false } });
    const res = await fresh.client.me.shareContact({
      body: { proof: contact({ userId: vali.id }) },
    });
    expect(res.status).toBe(200);
    const [c] = await t.db.select().from(customers);
    expect(c).toMatchObject({ telegramId: vali.id, botBlocked: false, writeAccess: 'refused' });
  });

  it('two concurrent verifications of one phone end in one customer, never a 500', async () => {
    for (let round = 0; round < 5; round++) {
      await t.reset();
      const [a, b] = await Promise.all([t.signIn(ali), t.signIn(vali)]);
      const [ra, rb] = await Promise.all([
        a.client.me.shareContact({ body: { proof: contact() } }),
        b.client.me.shareContact({ body: { proof: contact({ userId: vali.id }) } }),
      ]);
      expect([ra.status, rb.status].every((s) => s === 200 || s === 409)).toBe(true);
      const rows = await t.db.select().from(customers);
      expect(rows.filter((r) => r.phone === '+998901234567')).toHaveLength(1);
    }
  });
});

describe('write access', () => {
  it('records a refusal in write_access only, and audits it', async () => {
    const { client } = await t.signIn(ali);
    const res = await client.me.writeAccess({ body: { allowed: false } });
    expect(res.status === 200 && res.body.writeAccess).toBe('refused');
    const [c] = await t.db.select().from(customers);
    expect(c).toMatchObject({ writeAccess: 'refused', botBlocked: false });
    expect(await actions()).toContain('customer.write_access_refused');
    expect((await client.me.get()).status).toBe(200);
  });

  it('a grant updates write_access and never clears a bot-observed block', async () => {
    const { client } = await t.signIn(ali);
    await t.db.update(customers).set({ botBlocked: true });
    const res = await client.me.writeAccess({ body: { allowed: true } });
    expect(res.status === 200 && res.body.writeAccess).toBe('granted');
    const [c] = await t.db.select().from(customers);
    expect(c?.botBlocked).toBe(true);
  });

  it('the outbox sends nothing to a customer who refused or blocked the bot', async () => {
    const outboxSvc = t.app.get(OutboxService);
    const send = async (telegramId: number) => {
      const [id] = await outboxSvc.withTx((tx) =>
        outboxSvc.enqueue(tx, { chatId: telegramId, text: 'status' }),
      );
      return outboxSvc.deliver(id!);
    };
    const { client } = await t.signIn(ali);
    t.edges.telegram.sent.length = 0;
    expect(await send(ali.id)).toBe('sent'); // not asked yet: allowed
    await client.me.writeAccess({ body: { allowed: false } });
    expect(await send(ali.id)).not.toBe('sent');
    await client.me.writeAccess({ body: { allowed: true } });
    expect(await send(ali.id)).toBe('sent');
    await t.db.update(customers).set({ botBlocked: true });
    expect(await send(ali.id)).not.toBe('sent');
    expect(t.edges.telegram.sent).toHaveLength(2);
  });
});

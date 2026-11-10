import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { auditLog, birthdayCoupons, customers, eq, outbox } from '@lummi/db';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { BirthdayCouponJob } from '../src/birthday/birthday-job';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) for birthday coupons (ticket #30): the date of birth entered once, the daily
 * job at 10:00 Asia/Tashkent, «Мои скидки», the coupon as the order's one discount (ADR 0002), the
 * hold at order creation and the release on cancel (ADR 0005). Tashkent is UTC+5: 10:00 there is
 * 05:00Z. Seed prices: 10 ml 69 000, 30 ml 149 000, 50 ml 219 000; tariff 25 000 below 250 000.
 */
const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
});
afterEach(() => vi.restoreAllMocks());

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

/** A signed-in shopper; with `phone`, one who shared it (ADR 0004). */
async function shopper(user: TestUser = ali, phone: string | null = '998901234567') {
  const { client } = await t.signIn(user);
  if (phone) {
    const proof = signContact({
      botToken: TEST_BOT_TOKEN,
      userId: user.id,
      phone,
      authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
    });
    const res = await client.me.shareContact({ body: { proof } });
    if (res.status !== 200) throw new Error(`contact: ${res.status}`);
  }
  return client;
}
type Client = Awaited<ReturnType<typeof shopper>>;

const customerOf = async (user: TestUser) => {
  const [c] = await t.db.select().from(customers).where(eq(customers.telegramId, user.id));
  return c!;
};
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

describe('the date of birth: entered once', () => {
  it('is stored with when it was entered and consent, audited, and «Мои скидки» shows it', async () => {
    const s = await shopper();
    const res = await s.me.setBirthDate({ body: { birthDate: '1996-03-14', consent: true } });
    expect(res).toMatchObject({
      status: 200,
      body: {
        birthDate: '1996-03-14',
        birthdayCoupons: [],
        // entered 9 November 2026: 11 March 2027 is more than 14 days on
        nextBirthdayCoupon: { opensOn: '2027-03-11', percent: 20 },
        birthdayPercent: 20,
        birthdayDaysBefore: 3,
        needsConsent: false,
      },
    });
    const c = await customerOf(ali);
    expect(c).toMatchObject({ birthDate: '1996-03-14' });
    expect(c.birthDateSetAt?.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(c.dataConsentAt?.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(await audits('customer.birth_date_set')).toMatchObject([
      {
        actorType: 'customer',
        actorId: c.id,
        targetId: String(c.id),
        payload: { birthDate: '1996-03-14' },
      },
    ]);
    expect(await audits('customer.data_consent_given')).toMatchObject([
      { actorType: 'customer', payload: { via: 'birth_date' } },
    ]);
    expect((await s.me.discounts()).body).toMatchObject({ birthDate: '1996-03-14' });
  });

  it('cannot be changed by the customer afterwards (409), and the first value stays', async () => {
    const s = await shopper();
    await s.me.setBirthDate({ body: { birthDate: '1996-03-14', consent: true } });
    const again = await s.me.setBirthDate({ body: { birthDate: '1996-12-01', consent: true } });
    expect(again).toMatchObject({ status: 409, body: { code: 'already_set' } });
    expect(await customerOf(ali)).toMatchObject({ birthDate: '1996-03-14' });
  });

  it('asks consent from a customer who has given none (422), and not again once given', async () => {
    const s = await shopper();
    expect(await s.me.setBirthDate({ body: { birthDate: '1996-03-14' } })).toMatchObject({
      status: 422,
      body: { code: 'consent_required' },
    });
    await t.db
      .update(customers)
      .set({ dataConsentAt: new Date('2026-11-01T00:00:00Z') })
      .where(eq(customers.telegramId, ali.id));
    expect((await s.me.setBirthDate({ body: { birthDate: '1996-03-14' } })).status).toBe(200);
    // consent was already there: no second entry, the first instant kept
    expect(await audits('customer.data_consent_given')).toHaveLength(0);
  });

  it('needs the account phone (403): one phone, one account', async () => {
    const s = await shopper(ali, null);
    expect(
      await s.me.setBirthDate({ body: { birthDate: '1996-03-14', consent: true } }),
    ).toMatchObject({ status: 403, body: { code: 'phone_required' } });
  });

  it('refuses a day that is not in the calendar (400), after today in Tashkent or before 1900 (422)', async () => {
    const s = await shopper();
    // the contract's body schema refuses these before the handler
    const { token } = await t.signIn(ali);
    const put = (birthDate: string) =>
      fetch(`${t.baseUrl}/me/birth-date`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ birthDate, consent: true }),
      });
    for (const birthDate of ['1996-02-30', '1997-02-29', '14.03.1996', '1996-3-14']) {
      expect((await put(birthDate)).status).toBe(400);
    }
    // 9 November 2026 15:00 in Tashkent: the 10th is tomorrow there
    for (const birthDate of ['2026-11-10', '1899-12-31']) {
      expect(await s.me.setBirthDate({ body: { birthDate, consent: true } })).toMatchObject({
        status: 422,
        body: { code: 'invalid_birth_date' },
      });
    }
    // today in Tashkent is fine, and so is a leap day
    expect(
      (await s.me.setBirthDate({ body: { birthDate: '2026-11-09', consent: true } })).status,
    ).toBe(200);
    const other = await shopper(vali, '998901112233');
    expect(
      (await other.me.setBirthDate({ body: { birthDate: '2000-02-29', consent: true } })).status,
    ).toBe(200);
  });

  it('«Мои скидки» without a date: nothing ahead, the invitation’s percent, consent still to ask', async () => {
    const s = await shopper();
    expect(await s.me.discounts()).toMatchObject({
      status: 200,
      body: {
        birthDate: null,
        birthdayCoupons: [],
        nextBirthdayCoupon: null,
        birthdayPercent: 20,
        needsConsent: true,
      },
    });
  });
});

/** Enters the date of birth through the API at `enteredAt` (so the abuse guard counts from then). */
async function bornOn(
  birthDate: string,
  user: TestUser = ali,
  phone = '998901234567',
  enteredAt = new Date('2026-01-10T06:00:00Z'),
) {
  const was = t.edges.clock.now();
  t.edges.clock.set(enteredAt);
  const s = await shopper(user, phone);
  const res = await s.me.setBirthDate({ body: { birthDate, consent: true } });
  if (res.status !== 200) throw new Error(`birth date: ${res.status}`);
  t.edges.clock.set(was);
  return s;
}
const runJobAt = async (iso: string) => {
  t.edges.clock.set(new Date(iso));
  return t.app.get(BirthdayCouponJob).run();
};
const coupons = () => t.db.select().from(birthdayCoupons).orderBy(birthdayCoupons.id);
const messages = () => t.db.select().from(outbox).orderBy(outbox.id);

describe('the daily job at 10:00 Asia/Tashkent issues the coupon', () => {
  it('three days before the birthday at 10:00 Tashkent, not a second earlier, with the settings’ percent and cap and a message through the outbox', async () => {
    await bornOn('1996-03-14');
    // 09:59:59 in Tashkent on 11 March
    await runJobAt('2027-03-11T04:59:59Z');
    expect(await coupons()).toHaveLength(0);

    await runJobAt('2027-03-11T05:00:00Z');
    const [coupon, ...more] = await coupons();
    expect(more).toHaveLength(0);
    expect(coupon).toMatchObject({
      birthdayYear: 2027,
      birthday: '2027-03-14',
      percent: 20,
      maxAmount: 100_000,
      usedByOrderId: null,
    });
    expect(coupon!.issuedAt.toISOString()).toBe('2027-03-11T05:00:00.000Z');
    // works through 23:59:59 on 21 March in Tashkent
    expect(coupon!.expiresAt.toISOString()).toBe('2027-03-21T19:00:00.000Z');

    const [message] = await messages();
    expect(coupon!.outboxId).toBe(message!.id);
    expect(message).toMatchObject({ chatId: ali.id });
    expect(message!.text).toContain('−20%');
    expect(message!.text).toContain('100\u202f000\u202fсум'); // narrow no-break spaces
    expect(message!.text).toContain('21 марта');
    expect(message!.options).toMatchObject({
      reply_markup: { inline_keyboard: [[{ web_app: { url: expect.stringMatching(/^https:/) } }]] },
    });
  });

  it('writes the message in the customer’s language', async () => {
    await bornOn('1996-03-14', vali, '998901112233');
    await runJobAt('2027-03-11T05:00:00Z');
    const [message] = await messages();
    expect(message!.text).toContain('21-mart');
    expect(message!.text).toContain('100\u202f000\u202fsoʻmgacha');
  });

  it('follows the settings for percent, cap and the days before and after', async () => {
    const owner = await t.ownerSession();
    for (const [key, value] of [
      ['birthday.percent', 15],
      ['birthday.maxAmount', 50_000],
      ['birthday.daysBefore', 5],
      ['birthday.daysAfter', 2],
    ] as const) {
      const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
      expect(res.status).toBe(200);
    }
    await bornOn('1996-03-14');
    await runJobAt('2027-03-09T05:00:00Z');
    expect(await coupons()).toMatchObject([{ percent: 15, maxAmount: 50_000 }]);
    // through 16 March, two days after the birthday
    expect((await coupons())[0]!.expiresAt.toISOString()).toBe('2027-03-16T19:00:00.000Z');
  });

  it('run twice, or twice at once, issues one coupon and one message', async () => {
    await bornOn('1996-03-14');
    await runJobAt('2027-03-11T05:00:00Z');
    await runJobAt('2027-03-11T05:00:30Z');
    expect(await coupons()).toHaveLength(1);
    expect(await messages()).toHaveLength(1);

    // Vali's window opens a day later; three runs at once still issue his coupon once
    await bornOn('1996-03-15', vali, '998901112233');
    t.edges.clock.set(new Date('2027-03-12T05:00:00Z'));
    const job = t.app.get(BirthdayCouponJob);
    await Promise.all([job.run(), job.run(), job.run()]);
    expect((await coupons()).map((c) => c.birthday)).toEqual(['2027-03-14', '2027-03-15']);
    expect(await messages()).toHaveLength(2);
  });

  it('29 February: on 25 February in a common year, on 26 February in a leap year, once a year', async () => {
    await bornOn('2000-02-29');
    await runJobAt('2027-02-25T04:59:00Z');
    expect(await coupons()).toHaveLength(0);
    await runJobAt('2027-02-25T05:00:00Z');
    await runJobAt('2027-02-28T05:00:00Z');
    await runJobAt('2027-03-07T05:00:00Z');
    expect(await coupons()).toMatchObject([{ birthdayYear: 2027, birthday: '2027-02-28' }]);
    expect((await coupons())[0]!.expiresAt.toISOString()).toBe('2027-03-07T19:00:00.000Z');

    await runJobAt('2028-02-25T05:00:00Z');
    expect(await coupons()).toHaveLength(1);
    await runJobAt('2028-02-26T05:00:00Z');
    expect((await coupons()).map((c) => c.birthday)).toEqual(['2027-02-28', '2028-02-29']);
  });

  it('a 2 January birthday gets next year’s coupon on 30 December', async () => {
    await bornOn('1990-01-02');
    await runJobAt('2026-12-30T05:00:00Z');
    expect(await coupons()).toMatchObject([{ birthdayYear: 2027, birthday: '2027-01-02' }]);
  });

  it('a customer who blocked the bot or refused write access gets the coupon stored, with no message', async () => {
    await bornOn('1996-03-14');
    await bornOn('1996-03-14', vali, '998901112233');
    await t.db.update(customers).set({ botBlocked: true }).where(eq(customers.telegramId, ali.id));
    await t.db
      .update(customers)
      .set({ writeAccess: 'refused' })
      .where(eq(customers.telegramId, vali.id));
    await runJobAt('2027-03-11T05:00:00Z');
    expect(await coupons()).toMatchObject([{ outboxId: null }, { outboxId: null }]);
    expect(await messages()).toHaveLength(0);
  });

  it('the first coupon opens no sooner than 14 days after the date was entered (a setting)', async () => {
    // entered on 1 March: 11 March is only ten days on, so this year passes without a coupon
    await bornOn('1996-03-14', ali, '998901234567', new Date('2027-03-01T05:00:00Z'));
    await runJobAt('2027-03-11T05:00:00Z');
    await runJobAt('2027-03-15T05:00:00Z');
    expect(await coupons()).toHaveLength(0);
    await runJobAt('2028-03-11T05:00:00Z');
    expect(await coupons()).toMatchObject([{ birthdayYear: 2028 }]);
  });

  it('a day the job missed is caught up while the window is open, with the same validity, never after it', async () => {
    await bornOn('1996-03-14');
    await bornOn('1990-03-01', vali, '998901112233');
    // first job run since 2 March: Ali's window (11..21 March) is open, Vali's (26 Feb..8 Mar) is over
    await runJobAt('2027-03-12T05:00:00Z');
    expect(await coupons()).toMatchObject([{ birthday: '2027-03-14' }]);
    expect((await coupons())[0]!.expiresAt.toISOString()).toBe('2027-03-21T19:00:00.000Z');
  });
});

describe('the worker schedules the job', () => {
  it('as a BullMQ repeatable job at 10:00 every day, Asia/Tashkent', async () => {
    t.startWorker();
    const queue = new Queue(t.env.BIRTHDAY_QUEUE, { connection: { url: t.env.REDIS_URL } });
    try {
      let schedulers: Awaited<ReturnType<typeof queue.getJobSchedulers>> = [];
      for (const end = Date.now() + 10_000; schedulers.length === 0 && Date.now() < end;) {
        schedulers = await queue.getJobSchedulers();
        if (schedulers.length === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(schedulers).toMatchObject([{ pattern: '0 10 * * *', tz: 'Asia/Tashkent' }]);
    } finally {
      await queue.close();
    }
  });
});

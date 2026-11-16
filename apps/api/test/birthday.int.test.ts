import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  auditLog,
  birthdayCoupons,
  btsPoints,
  customers,
  eq,
  fragrances,
  orders,
  outbox,
  regions,
  volumes,
} from '@lummi/db';
import pg from 'pg';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { BirthdayCouponJob } from '../src/birthday/birthday-job';
import { holdBirthdayCoupon } from '../src/birthday/birthday-coupons';
import { DiscountSourceHooks } from '../src/order-status/discount-sources';
import { OutboxService } from '../src/outbox/outbox.service';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) for birthday coupons (ticket #30): the date of birth entered once, the daily
 * job at 10:00 Asia/Tashkent, «Мои скидки», the coupon as the order's one discount (ADR 0002), the
 * hold at order creation and the release on cancel (ADR 0005). Tashkent is UTC+5: 10:00 there is
 * 05:00Z. Seed prices: 10 ml 69 000, 30 ml 149 000, 50 ml 219 000; tariff 25 000 below 250 000.
 */
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
        payload: { via: 'profile', set: true },
      },
    ]);
    // the date of birth is personal data: the audit, which staff read, records only the fact
    const [entry] = await audits('customer.birth_date_set');
    expect(JSON.stringify(entry!.payload)).not.toContain('1996');
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
/** A fresh session at the fake clock's now (a session lives an hour; tests jump months). */
const signedIn = async (user: TestUser = ali) => (await t.signIn(user)).client;
const discountsNow = async (user: TestUser = ali) =>
  (await (await signedIn(user)).me.discounts()).body;
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

    // Vali's window opens a day later. Three runs at once, held at a barrier until all three
    // wait to write his coupon, then let go together: the unique index lets one insert.
    await bornOn('1996-03-15', vali, '998901112233');
    t.edges.clock.set(new Date('2027-03-12T05:00:00Z'));
    const job = t.app.get(BirthdayCouponJob);
    await whileTableLocked('birthday_coupons', 3, () =>
      Promise.all([job.run(), job.run(), job.run()]),
    );
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

  it('the issue hour is a setting: at 14:00 Tashkent, not a second earlier', async () => {
    const owner = await t.ownerSession();
    const res = await owner.client.admin.settings.update({
      params: { key: 'birthday.issueHour' },
      body: { value: 14 },
    });
    expect(res.status).toBe(200);
    await bornOn('1996-03-14');
    await runJobAt('2027-03-11T05:00:00Z'); // 10:00
    await runJobAt('2027-03-11T08:59:59Z'); // 13:59:59
    expect(await coupons()).toHaveLength(0);
    await runJobAt('2027-03-11T09:00:00Z'); // 14:00
    const [coupon] = await coupons();
    expect(coupon!.issuedAt.toISOString()).toBe('2027-03-11T09:00:00.000Z');
    expect(coupon!.expiresAt.toISOString()).toBe('2027-03-21T19:00:00.000Z');
  });

  it('one customer’s failure does not stop the run; the run then fails, so it is retried', async () => {
    await bornOn('1996-03-14');
    await bornOn('1996-03-14', vali, '998901112233');
    const outbox = t.app.get(OutboxService);
    const enqueue = outbox.enqueue.bind(outbox);
    vi.spyOn(outbox, 'enqueue').mockImplementation(async (tx, m) => {
      const list = Array.isArray(m) ? m : [m];
      if (list.some((x) => x.chatId === ali.id)) throw new Error('outbox down for one row');
      return enqueue(tx, m);
    });
    await expect(runJobAt('2027-03-11T05:00:00Z')).rejects.toThrow(/1 of 2/);
    // Vali's coupon and message went through; Ali's transaction rolled back whole
    expect((await coupons()).map((c) => c.customerId)).toEqual([(await customerOf(vali)).id]);
    expect(await messages()).toMatchObject([{ chatId: vali.id }]);
    vi.restoreAllMocks();
    // the retry issues the rest, once
    await runJobAt('2027-03-11T05:00:05Z');
    expect(await coupons()).toHaveLength(2);
    expect(await messages()).toHaveLength(2);
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
  it('as a BullMQ repeatable job every hour on the Asia/Tashkent clock (the hour is a setting)', async () => {
    t.startWorker();
    const queue = new Queue(t.env.BIRTHDAY_QUEUE, { connection: { url: t.env.REDIS_URL } });
    try {
      let schedulers: Awaited<ReturnType<typeof queue.getJobSchedulers>> = [];
      for (const end = Date.now() + 10_000; schedulers.length === 0 && Date.now() < end;) {
        schedulers = await queue.getJobSchedulers();
        if (schedulers.length === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(schedulers).toMatchObject([{ pattern: '0 * * * *', tz: 'Asia/Tashkent' }]);
    } finally {
      await queue.close();
    }
  });
});

describe('«Мои скидки» lists active coupons with days left', () => {
  it('from 10:00 on the first day through 23:59:59 on the last; then the next year’s is ahead', async () => {
    await bornOn('1996-03-14');
    await runJobAt('2027-03-11T05:00:00Z');
    expect(await discountsNow()).toMatchObject({
      birthDate: '1996-03-14',
      birthdayCoupons: [{ percent: 20, maxAmount: 100_000, lastDay: '2027-03-21', daysLeft: 10 }],
      nextBirthdayCoupon: null,
    });
    // 23:59:59 on 21 March in Tashkent: the last day, still listed
    t.edges.clock.set(new Date('2027-03-21T18:59:59Z'));
    expect(await discountsNow()).toMatchObject({
      birthdayCoupons: [{ lastDay: '2027-03-21', daysLeft: 0 }],
    });
    // 00:00 on 22 March: gone, and next year's is the one to come
    t.edges.clock.set(new Date('2027-03-21T19:00:00Z'));
    expect(await discountsNow()).toMatchObject({
      birthdayCoupons: [],
      nextBirthdayCoupon: { opensOn: '2028-03-11', percent: 20 },
    });
  });

  it('shows the coupon of a customer who blocked the bot', async () => {
    await bornOn('1996-03-14');
    await t.db.update(customers).set({ botBlocked: true }).where(eq(customers.telegramId, ali.id));
    await runJobAt('2027-03-12T05:00:00Z');
    expect(await discountsNow()).toMatchObject({
      birthdayCoupons: [{ lastDay: '2027-03-21', daysLeft: 9 }],
    });
  });
});

/** The coupon as the order's one discount (ADR 0002, 0005, 0007, 0008). */
describe('the coupon in the cart and the order', () => {
  beforeEach(async () => {
    await t.seedCatalog();
    await importBtsPoints(t.db, snapshot);
  });

  async function slugs(n: number) {
    const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
    return rows
      .map((r) => r.slug)
      .sort()
      .slice(0, n);
  }
  async function add(c: Client, slug: string, ml: 10 | 30 | 50, qty = 1) {
    const res = await c.cart.addLine({ body: { slug, ml, qty } });
    if (res.status !== 200) throw new Error(`add ${slug}: ${res.status}`);
    return res.body;
  }
  async function quoteOf(c: Client) {
    const cart = await c.cart.get();
    if (cart.status !== 200) throw new Error(`cart ${cart.status}`);
    return cart.body.quote;
  }
  async function samarkand() {
    const [region] = (await t.db.select().from(regions)).filter((r) =>
      r.nameRu.startsWith('Самарк'),
    );
    const [point] = await t.db
      .select()
      .from(btsPoints)
      .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
      .limit(1);
    return { region: region!, point: point! };
  }
  /** The checkout body for the cart (or a buy-now `item`) as quoted now, to a Samarkand point. */
  async function orderBody(c: Client, item?: string): Promise<CreateOrderBody> {
    const { region, point } = await samarkand();
    const checkout = await c.checkout.get({ query: { regionId: region.id, item } });
    if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
    return {
      recipientName: 'Ali Valiyev',
      recipientPhone: '+998901234567',
      delivery: { kind: 'point', pointId: point.id },
      consent: true,
      confirmedTotal: checkout.body.quote.total,
      confirmedDiscount: checkout.body.quote.discount,
      idempotencyKey: randomUUID(),
      ...(item ? { item } : {}),
    };
  }
  async function placeOrder(c: Client, item?: string) {
    const res = await c.orders.create({ body: await orderBody(c, item) });
    if (res.status !== 201) throw new Error(`order ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
  async function cancel(c: Client, number: number) {
    const res = await c.orders.cancel({
      params: { number },
      body: { expectedStatus: 'awaiting_payment' },
    });
    if (res.status !== 200) throw new Error(`cancel ${res.status}`);
  }
  /** Ali, born 14 March, holding this year's coupon (issued 11 March 10:00, through 21 March). */
  async function withCoupon() {
    await bornOn('1996-03-14');
    await runJobAt('2027-03-12T07:00:00Z');
    const [coupon] = await coupons();
    return { s: await signedIn(), coupon: coupon! };
  }

  it('applies by itself when it lowers the total: items × %, never delivery', async () => {
    const [a] = await slugs(1);
    const { s, coupon } = await withCoupon();
    await add(s, a!, 50); // 219 000
    expect(await quoteOf(s)).toMatchObject({
      itemsSubtotal: 219_000,
      discount: { type: 'birthday_coupon', id: coupon.id, amount: 43_800 },
      thresholdBase: 'after',
      deliveryFee: 25_000,
      total: 200_200,
    });
    // applied, so nothing waits behind a code
    expect((await s.cart.get()).body).toMatchObject({ entitlementWaiting: null });
  });

  it('keeps the percent and cap it was issued with when the settings change', async () => {
    const [a] = await slugs(1);
    const { s } = await withCoupon();
    const owner = await t.ownerSession();
    await owner.client.admin.settings.update({
      params: { key: 'birthday.percent' },
      body: { value: 5 },
    });
    await owner.client.admin.settings.update({
      params: { key: 'birthday.maxAmount' },
      body: { value: 10_000 },
    });
    await add(s, a!, 50);
    expect(await quoteOf(s)).toMatchObject({ discount: { amount: 43_800 } });
  });

  it('an entered promo code wins; the coupon is offered as the alternative', async () => {
    const [a] = await slugs(1);
    const { s, coupon } = await withCoupon();
    const owner = await t.ownerSession();
    const created = await owner.client.admin.promoCodes.create({
      body: {
        code: 'BLOGER10',
        kind: 'percent',
        percent: 10,
        amount: null,
        maxDiscount: null,
        expiresOn: null,
        minOrderTotal: null,
        totalLimit: null,
        perCustomerLimit: null,
        newCustomersOnly: false,
        appliesToMarkedDown: false,
        active: true,
      },
    });
    expect(created.status).toBe(201);
    await add(s, a!, 50);
    await s.cart.applyPromoCode({ body: { code: 'BLOGER10' } });
    expect(await quoteOf(s)).toMatchObject({
      discount: { type: 'promo_code', code: 'BLOGER10', amount: 21_900 },
      total: 222_100,
      alternatives: [
        { discount: { type: 'birthday_coupon', id: coupon.id, amount: 43_800 }, total: 200_200 },
      ],
    });
    // the cart says the coupon waits behind the code, with its terms and last day
    expect((await s.cart.get()).body).toMatchObject({
      entitlementWaiting: {
        type: 'birthday_coupon',
        id: coupon.id,
        percent: 20,
        lastDay: '2027-03-21',
      },
    });
    // the order takes the code, and the coupon stays the customer's
    const order = await placeOrder(s);
    expect(order.discount).toMatchObject({ type: 'promo_code' });
    expect((await s.me.discounts()).body).toMatchObject({ birthdayCoupons: [{ id: coupon.id }] });
  });

  it('«Применить купон» is the code taken out: the server then picks the coupon by itself', async () => {
    const [a] = await slugs(1);
    const { s, coupon } = await withCoupon();
    const owner = await t.ownerSession();
    await owner.client.admin.promoCodes.create({
      body: {
        code: 'BLOGER10',
        kind: 'percent',
        percent: 10,
        amount: null,
        maxDiscount: null,
        expiresOn: null,
        minOrderTotal: null,
        totalLimit: null,
        perCustomerLimit: null,
        newCustomersOnly: false,
        appliesToMarkedDown: false,
        active: true,
      },
    });
    await add(s, a!, 50);
    await s.cart.applyPromoCode({ body: { code: 'BLOGER10' } });
    const after = await s.cart.removePromoCode();
    expect(after).toMatchObject({
      status: 200,
      body: {
        promoCode: null,
        entitlementWaiting: null,
        quote: { discount: { type: 'birthday_coupon', id: coupon.id } },
      },
    });
  });

  it('a code that does not apply leaves nothing waiting: the coupon is applied', async () => {
    const [a] = await slugs(1);
    const { s, coupon } = await withCoupon();
    await add(s, a!, 50);
    await s.cart.applyPromoCode({ body: { code: 'NOSUCHCODE' } });
    expect((await s.cart.get()).body).toMatchObject({
      quote: { discount: { type: 'birthday_coupon', id: coupon.id } },
      entitlementWaiting: null,
    });
  });

  it('the order holds it (ADR 0005): the snapshot carries it, Profile no longer lists it, the next cart has none', async () => {
    const [a, b] = await slugs(2);
    const { s, coupon } = await withCoupon();
    await add(s, a!, 50);
    const order = await placeOrder(s);
    expect(order).toMatchObject({
      discount: { type: 'birthday_coupon', id: coupon.id, amount: 43_800 },
      total: 200_200,
    });
    const [row] = await t.db.select().from(orders).where(eq(orders.number, order.number));
    expect((await coupons())[0]).toMatchObject({ usedByOrderId: row!.id });
    expect((await s.me.discounts()).body).toMatchObject({
      birthdayCoupons: [],
      nextBirthdayCoupon: { opensOn: '2028-03-11' },
    });
    await add(s, b!, 50);
    expect(await quoteOf(s)).toMatchObject({ discount: null, total: 244_000 });
  });

  it('«Купить сейчас» takes it too: the server picks it by itself', async () => {
    const [a] = await slugs(1);
    const { s, coupon } = await withCoupon();
    const order = await placeOrder(s, `volume:${a}:50`);
    expect(order.discount).toMatchObject({ type: 'birthday_coupon', id: coupon.id });
  });

  it('two concurrent orders cannot both use it: one holds it, the other gets 409 with the new quote', async () => {
    const [a, b] = await slugs(2);
    const { s, coupon } = await withCoupon();
    const bodies = [
      await orderBody(s, `volume:${a}:50`),
      await orderBody(s, `volume:${b}:50`),
    ] as const;
    expect(bodies.map((x) => x.confirmedDiscount)).toMatchObject([
      { type: 'birthday_coupon', id: coupon.id },
      { type: 'birthday_coupon', id: coupon.id },
    ]);
    // both run while the coupon cannot be written: the first waits at its hold, the second behind it
    const results = await whileTableLocked('birthday_coupons', 2, () =>
      Promise.all([s.orders.create({ body: bodies[0] }), s.orders.create({ body: bodies[1] })]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 201)).toMatchObject({
      body: { discount: { type: 'birthday_coupon', id: coupon.id, amount: 43_800 } },
    });
    expect(results.find((r) => r.status === 409)).toMatchObject({
      body: { code: 'total_changed', checkout: { quote: { discount: null, total: 244_000 } } },
    });
    expect(await t.db.select().from(orders)).toHaveLength(1);
  });

  it('the hold is a conditional update: two transactions holding one coupon, only one wins', async () => {
    const [a, b] = await slugs(2);
    const { s, coupon } = await withCoupon();
    // two orders that hold nothing (the coupon is spent and given back first)
    const first = await placeOrder(s, `volume:${a}:10`);
    const second = await placeOrder(s, `volume:${b}:10`);
    const ids = await t.db.select({ id: orders.id, number: orders.number }).from(orders);
    const idOf = (n: number) => ids.find((r) => r.number === n)!.id;
    await t.db.update(birthdayCoupons).set({ usedByOrderId: null });
    const now = t.edges.clock.now();
    const hold = (orderId: number) => ({
      id: coupon.id,
      customerId: coupon.customerId,
      orderId,
      now,
    });

    let held!: () => void;
    const firstHeld = new Promise<void>((r) => (held = r));
    let commit!: () => void;
    const mayCommit = new Promise<void>((r) => (commit = r));
    const one = t.db.transaction(async (tx) => {
      const ok = await holdBirthdayCoupon(tx, hold(idOf(first.number)));
      held();
      await mayCommit;
      return ok;
    });
    await firstHeld;
    const two = t.db.transaction((tx) => holdBirthdayCoupon(tx, hold(idOf(second.number))));
    await waitForLockWaiters(1);
    commit();
    expect(await Promise.all([one, two])).toEqual([true, false]);
    expect((await coupons())[0]).toMatchObject({ usedByOrderId: idOf(first.number) });
  });

  it('the hold itself refuses a coupon past its end: held at 23:59:59 on the last day, not at 00:00', async () => {
    const [a, b] = await slugs(2);
    const { s, coupon } = await withCoupon();
    const first = await placeOrder(s, `volume:${a}:10`);
    const second = await placeOrder(s, `volume:${b}:10`);
    const ids = await t.db.select({ id: orders.id, number: orders.number }).from(orders);
    const idOf = (n: number) => ids.find((r) => r.number === n)!.id;
    await t.db.update(birthdayCoupons).set({ usedByOrderId: null });
    const holdAt = (orderId: number, iso: string) =>
      t.db.transaction((tx) =>
        holdBirthdayCoupon(tx, {
          id: coupon.id,
          customerId: coupon.customerId,
          orderId,
          now: new Date(iso),
        }),
      );
    expect(await holdAt(idOf(first.number), '2027-03-21T19:00:00Z')).toBe(false);
    expect((await coupons())[0]).toMatchObject({ usedByOrderId: null });
    expect(await holdAt(idOf(second.number), '2027-03-21T18:59:59Z')).toBe(true);
    expect((await coupons())[0]).toMatchObject({ usedByOrderId: idOf(second.number) });
  });

  it('a cancel within validity gives it back (ADR 0005), through the release hook', async () => {
    const [a] = await slugs(1);
    const { s, coupon } = await withCoupon();
    await add(s, a!, 50);
    const order = await placeOrder(s);
    const release = vi.spyOn(t.app.get(DiscountSourceHooks), 'release');
    t.edges.clock.set(new Date('2027-03-21T18:00:00Z')); // 23:00 on the last day
    const later = await signedIn();
    await cancel(later, order.number);
    expect(release).toHaveBeenCalledTimes(1);
    expect((await coupons())[0]).toMatchObject({ usedByOrderId: null });
    expect((await later.me.discounts()).body).toMatchObject({
      birthdayCoupons: [{ id: coupon.id, daysLeft: 0 }],
    });
    // the cancelled lines are not back in the cart: a new one takes the coupon again
    await add(later, a!, 50);
    expect(await quoteOf(later)).toMatchObject({
      discount: { type: 'birthday_coupon', id: coupon.id },
    });
  });

  it('a cancel after validity does not bring it back', async () => {
    const [a] = await slugs(1);
    const { s } = await withCoupon();
    await add(s, a!, 50);
    const order = await placeOrder(s);
    t.edges.clock.set(new Date('2027-03-21T19:00:00Z')); // 00:00 on 22 March
    const later = await signedIn();
    await cancel(later, order.number);
    // lost, not given back: it stays with the order that used it (ADR 0005)
    const [row] = await t.db.select().from(orders).where(eq(orders.number, order.number));
    expect((await coupons())[0]).toMatchObject({ usedByOrderId: row!.id });
    expect((await later.me.discounts()).body).toMatchObject({
      birthdayCoupons: [],
      nextBirthdayCoupon: { opensOn: '2028-03-11' },
    });
    await add(later, a!, 50);
    expect(await quoteOf(later)).toMatchObject({ discount: null });
  });

  it('a coupon that ended between the quote and the order is 409 with the new quote', async () => {
    const [a] = await slugs(1);
    const { s } = await withCoupon();
    await add(s, a!, 50);
    t.edges.clock.set(new Date('2027-03-21T18:59:59Z')); // 23:59:59 on the last day
    const later = await signedIn();
    const body = await orderBody(later);
    expect(body).toMatchObject({ confirmedTotal: 200_200, confirmedDiscount: { amount: 43_800 } });
    t.edges.clock.set(new Date('2027-03-21T19:00:00Z'));
    expect(await later.orders.create({ body })).toMatchObject({
      status: 409,
      body: { code: 'total_changed', checkout: { quote: { discount: null, total: 244_000 } } },
    });
    expect(await t.db.select().from(orders)).toHaveLength(0);
  });

  it('skips marked-down items by default (ADR 0008)', async () => {
    const [a, b] = await slugs(2);
    const { s } = await withCoupon();
    const [v] = await t.db
      .select({ id: volumes.id })
      .from(volumes)
      .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
      .where(and(eq(fragrances.slug, a!), eq(volumes.ml, 50)));
    await t.db.update(volumes).set({ salePrice: 175_000 }).where(eq(volumes.id, v!.id));
    await add(s, a!, 50); // 175 000 marked down
    await add(s, b!, 30); // 149 000
    expect(await quoteOf(s)).toMatchObject({ discount: { amount: 29_800 }, total: 294_200 });
  });
});

describe('the date of birth at checkout', () => {
  beforeEach(async () => {
    await t.seedCatalog();
    await importBtsPoints(t.db, snapshot);
  });

  async function checkoutBody(c: Client, over: Partial<CreateOrderBody> = {}) {
    const [region] = (await t.db.select().from(regions)).filter((r) =>
      r.nameRu.startsWith('Самарк'),
    );
    const [point] = await t.db
      .select()
      .from(btsPoints)
      .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
      .limit(1);
    const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
    const item = `volume:${f!.slug}:10`;
    const checkout = await c.checkout.get({ query: { regionId: region!.id, item } });
    if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
    return {
      checkout: checkout.body,
      body: {
        recipientName: 'Ali Valiyev',
        recipientPhone: '+998901234567',
        delivery: { kind: 'point', pointId: point!.id },
        consent: true,
        confirmedTotal: checkout.body.quote.total,
        confirmedDiscount: checkout.body.quote.discount,
        idempotencyKey: randomUUID(),
        item,
        ...over,
      } satisfies CreateOrderBody,
    };
  }

  it('checkout offers it while there is none, with the coupon’s percent', async () => {
    const s = await shopper();
    expect((await checkoutBody(s)).checkout.birthday).toEqual({ date: null, percent: 20 });
  });

  it('checkout carries the delivery term from the setting `delivery.etaHours`', async () => {
    const s = await shopper();
    expect((await checkoutBody(s)).checkout.deliveryEtaHours).toBe(48);
    const owner = await t.ownerSession();
    const res = await owner.client.admin.settings.update({
      params: { key: 'delivery.etaHours' },
      body: { value: 72 },
    });
    expect(res.status).toBe(200);
    expect((await checkoutBody(s)).checkout.deliveryEtaHours).toBe(72);
  });

  it('is stored with the first order, under the order’s consent, and audited', async () => {
    const s = await shopper();
    const { body } = await checkoutBody(s, { birthDate: '1996-03-14' });
    expect((await s.orders.create({ body })).status).toBe(201);
    const c = await customerOf(ali);
    expect(c).toMatchObject({ birthDate: '1996-03-14' });
    expect(c.birthDateSetAt?.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(await audits('customer.birth_date_set')).toMatchObject([
      { payload: { via: 'checkout', set: true } },
    ]);
    expect((await checkoutBody(s)).checkout.birthday).toEqual({ date: '1996-03-14', percent: 20 });
  });

  it('is ignored once the customer has one: entered once', async () => {
    const s = await shopper();
    await s.me.setBirthDate({ body: { birthDate: '1996-03-14', consent: true } });
    const { body } = await checkoutBody(s, { birthDate: '1990-01-01' });
    expect((await s.orders.create({ body })).status).toBe(201);
    expect(await customerOf(ali)).toMatchObject({ birthDate: '1996-03-14' });
  });

  it('a day after today in Tashkent is 422 invalid_birth_date, and no order is made', async () => {
    const s = await shopper();
    const { body } = await checkoutBody(s, { birthDate: '2026-11-10' });
    expect(await s.orders.create({ body })).toMatchObject({
      status: 422,
      body: { code: 'invalid_birth_date' },
    });
    expect(await t.db.select().from(orders)).toHaveLength(0);
  });
});

/**
 * Runs `run` while another session holds an EXCLUSIVE lock on `table` (reads pass, writes wait),
 * and releases it only once `waiters` sessions are blocked on a lock: the race is then real.
 */
async function whileTableLocked<T>(table: string, waiters: number, run: () => Promise<T>) {
  const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query('begin');
    await locker.query(`lock table ${table} in exclusive mode`);
    const pending = run();
    // polled from another session: inside the locker's transaction Postgres keeps serving the
    // first snapshot of pg_stat_activity, so the count would never move
    await waitForLockWaiters(waiters);
    await locker.query('commit');
    return await pending;
  } finally {
    await locker.end();
  }
}

/** Waits until `n` sessions of this database are blocked on a lock (polled outside any transaction). */
async function waitForLockWaiters(n: number) {
  const client = new pg.Client({ connectionString: t.env.DATABASE_URL });
  await client.connect();
  try {
    for (const deadline = Date.now() + 10_000; ;) {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
         where datname = current_database() and state = 'active' and wait_event_type = 'Lock'
           and pid <> pg_backend_pid()`,
      );
      if (rows[0]!.n >= n) return;
      if (Date.now() > deadline)
        throw new Error(`only ${rows[0]!.n} of ${n} sessions reached a lock`);
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    await client.end();
  }
}

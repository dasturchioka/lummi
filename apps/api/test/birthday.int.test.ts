import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { auditLog, customers, eq } from '@lummi/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
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

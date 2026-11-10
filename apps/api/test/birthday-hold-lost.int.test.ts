import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signContact } from '@lummi/contracts/sign-contact';
import { and, birthdayCoupons, btsPoints, eq, fragrances, orders, regions, sql } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Coupons from '../src/birthday/birthday-coupons';
import { holdBirthdayCoupon } from '../src/birthday/birthday-coupons';
import { BirthdayCouponJob } from '../src/birthday/birthday-job';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';

// The hold is the real one unless a test says otherwise for one call.
vi.mock('../src/birthday/birthday-coupons', async (importOriginal) => {
  const real = await importOriginal<typeof Coupons>();
  return { ...real, holdBirthdayCoupon: vi.fn(real.holdBirthdayCoupon) };
});

/**
 * ADR 0005's guard (ticket #30): the coupon the quote applied is gone by the time `createOrder`
 * holds it. Nothing in the shop does that under the customer lock, so another session ends the
 * coupon from inside the hold; the order is then created again from a new quote, which no longer
 * has it, and the shopper gets 409 with the new total. No order is left behind.
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
  t.edges.clock.set(new Date('2026-01-10T06:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir, limit: 2 });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };

async function signedIn() {
  const { client } = await t.signIn(ali);
  return client;
}

describe('the coupon taken between the quote and the hold', () => {
  it('is 409 with the new quote, and no order is made', async () => {
    const s = await signedIn();
    const proof = signContact({
      botToken: TEST_BOT_TOKEN,
      userId: ali.id,
      phone: '998901234567',
      authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
    });
    expect((await s.me.shareContact({ body: { proof } })).status).toBe(200);
    expect(
      (await s.me.setBirthDate({ body: { birthDate: '1996-03-14', consent: true } })).status,
    ).toBe(200);
    // issued at 10:00 Tashkent on 11 March; the order comes the next day
    t.edges.clock.set(new Date('2027-03-11T05:00:00Z'));
    await t.app.get(BirthdayCouponJob).run();
    t.edges.clock.set(new Date('2027-03-12T07:00:00Z'));
    const [coupon] = await t.db.select().from(birthdayCoupons);

    const client = await signedIn();
    const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
    const item = `volume:${f!.slug}:50`;
    const [region] = (await t.db.select().from(regions)).filter((r) =>
      r.nameRu.startsWith('Самарк'),
    );
    const [point] = await t.db
      .select()
      .from(btsPoints)
      .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
      .limit(1);
    const checkout = await client.checkout.get({ query: { regionId: region!.id, item } });
    if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
    expect(checkout.body.quote.discount).toMatchObject({ type: 'birthday_coupon', id: coupon!.id });

    // another session ends the coupon (committed on its own) just as the order tries to hold it
    vi.mocked(holdBirthdayCoupon).mockImplementationOnce(async () => {
      await t.db
        .update(birthdayCoupons)
        .set({ expiresAt: sql`${birthdayCoupons.issuedAt} + interval '1 second'` })
        .where(eq(birthdayCoupons.id, coupon!.id));
      return false;
    });
    const res = await client.orders.create({
      body: {
        recipientName: 'Ali Valiyev',
        recipientPhone: '+998901234567',
        delivery: { kind: 'point', pointId: point!.id },
        consent: true,
        confirmedTotal: checkout.body.quote.total,
        confirmedDiscount: checkout.body.quote.discount,
        idempotencyKey: randomUUID(),
        item,
      },
    });
    expect(res).toMatchObject({
      status: 409,
      body: { code: 'total_changed', checkout: { quote: { discount: null } } },
    });
    expect(await t.db.select().from(orders)).toHaveLength(0);
    expect(vi.mocked(holdBirthdayCoupon)).toHaveBeenCalledTimes(1);
  });
});

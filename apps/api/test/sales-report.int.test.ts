import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, fragrances, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { lastTashkentDays, salesSummary } from '../src/reports/sales-summary';
import { fulfilTo, pay, placeOrder, tashkent } from './harness/fulfilment';
import { shopper, slugs } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the sales report (#42) over HTTP, as the owner opens it in the admin panel.
 * The money itself is proven by the 20-order gate (`sales-report-gate.int.test.ts`); here the
 * door, the range and the export.
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
  t.edges.clock.set(tashkent('2026-11-10 09:00'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 4201, first_name: 'Ali', language_code: 'ru' };

/** One 30 ml bottle at 150 000, delivered (to Samarkand: 25 000 delivery) at `deliveredAt`. */
async function deliveredBottle(deliveredAt: string) {
  const [slug] = await slugs(t, 1);
  const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug!));
  await t.db
    .update(volumes)
    .set({ price: 150_000 })
    .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, 30)));
  const client = await shopper(t, ali, '998901112233');
  await client.cart.addLine({ body: { slug: slug!, ml: 30, qty: 1 } });
  const order = await placeOrder(t, client);
  await pay(t, order.number);
  await fulfilTo(t, order.number, 'handed_to_bts');
  t.edges.clock.set(tashkent(deliveredAt));
  await fulfilTo(t, order.number, 'delivered');
  return { order, fragrance: f! };
}

describe('the sales report: owner only', () => {
  it('shows a delivered order on the Tashkent day it was delivered', async () => {
    const { fragrance } = await deliveredBottle('2026-11-11 15:00');
    const { client } = await t.ownerSession();

    const res = await client.admin.reports.sales({
      query: { from: '2026-11-10', to: '2026-11-11' },
    });

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const empty = {
      orders: 0,
      itemsBeforeDiscount: 0,
      discount: 0,
      delivery: 0,
      refunds: 0,
      net: 0,
      averageCheck: null,
    };
    const sold = {
      orders: 1,
      itemsBeforeDiscount: 150_000,
      discount: 0,
      delivery: 25_000,
      refunds: 0,
      net: 150_000,
      averageCheck: 150_000,
    };
    expect(res.body).toMatchObject({
      from: '2026-11-10',
      to: '2026-11-11',
      days: [
        { day: '2026-11-10', ...empty },
        { day: '2026-11-11', ...sold },
      ],
      totals: sold,
      fragrances: [{ fragranceId: fragrance.id, units: 1, net: 150_000 }],
      volumes: [{ fragranceId: fragrance.id, ml: 30, units: 1, net: 150_000 }],
      sets: [
        { kind: 'discovery_set', units: 0, net: 0 },
        { kind: 'builder_set', units: 0, net: 0 },
      ],
    });
  });

  it('covers the last 30 Tashkent days without a range, today included', async () => {
    // 23:30 on 14 November in Tashkent is still 14 November there (18:30 UTC)
    t.edges.clock.set(tashkent('2026-11-14 23:30'));
    const { client } = await t.ownerSession();
    const res = await client.admin.reports.sales({ query: {} });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect([res.body.from, res.body.to, res.body.days.length]).toEqual([
      '2026-10-16',
      '2026-11-14',
      30,
    ]);
    const until = await client.admin.reports.sales({ query: { to: '2026-11-05' } });
    expect(until.status === 200 && [until.body.from, until.body.to]).toEqual([
      '2026-10-07',
      '2026-11-05',
    ]);
  });

  it('refuses a range that runs backwards or passes a year (422)', async () => {
    const { client } = await t.ownerSession();
    const ask = (from: string, to: string) => client.admin.reports.sales({ query: { from, to } });
    expect((await ask('2026-11-12', '2026-11-11')).body).toEqual({ code: 'invalid_range' });
    expect((await ask('2025-11-14', '2026-11-15')).status).toBe(422); // 367 days
    expect((await ask('2025-11-15', '2026-11-15')).status).toBe(200); // 366 days
    expect((await ask('2026-02-30', '2026-03-01')).status).toBe(400); // not a calendar day
  });

  it('salesSummary, called directly (the admin Home), refuses what is not a report range', async () => {
    const refused = (from: string, to: string) =>
      expect(salesSummary(t.db, { from, to })).rejects.toThrow(RangeError);
    await refused('2026-11-12', '2026-11-11'); // backwards
    await refused('2025-11-14', '2026-11-15'); // 367 days
    await refused('2026-11-01', '2026-02-30'); // not a calendar day
    await refused('2026-11-01', '2026-11-1'); // not written YYYY-MM-DD
    // the last 7 days up to 00:30 on 15 November in Tashkent (19:30 UTC on the 14th)
    const week = lastTashkentDays(7, tashkent('2026-11-15 00:30'));
    expect(week).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect((await salesSummary(t.db, week)).days).toHaveLength(7);
  });

  it('is refused to a manager (403) and to anyone without a staff session (401)', async () => {
    const manager = await t.managerSession();
    const query = { from: '2026-11-10', to: '2026-11-11' };
    expect((await manager.client.admin.reports.sales({ query })).status).toBe(403);
    expect((await t.client.admin.reports.sales({ query })).status).toBe(401);
    const exported = await fetch(`${t.baseUrl}/admin/reports/sales/export`, {
      headers: { cookie: manager.cookie },
    });
    expect(exported.status).toBe(403);
  });
});

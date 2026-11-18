import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { placeTwentyOrders, type FixtureCatalog } from './fixtures/sales-report-orders';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * #65: the promo list's delivered orders and net sales per code are the marketing report's own
 * figures for the same code over the code's life, over the 20-order fixture (it holds delivered,
 * cancelled and returned orders and refunds; the clock ends 15 Nov 2026, the codes were made 7 Nov).
 */
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let catalog: FixtureCatalog;
let owner: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  ({ catalog } = await placeTwentyOrders(t));
  owner = await t.ownerSession();
}, 300_000);
afterAll(() => t?.close());

describe('promo codes list: what each code brought (#65)', () => {
  it('equals the marketing report for the same code over its life', async () => {
    const list = await owner.client.admin.promoCodes.list();
    if (list.status !== 200) throw new Error(`list ${list.status}`);
    expect(list.body).toHaveLength(3);
    for (const row of list.body) {
      expect(row.statsFrom).toBe('2026-11-07');
      expect(row.statsTo).toBe('2026-11-15');
      const res = await owner.client.admin.reports.marketing({
        query: { from: row.statsFrom, to: row.statsTo, code: row.code },
      });
      if (res.status !== 200) throw new Error(`report ${res.status}`);
      const mine = res.body.promoCodes.find((p) => p.code === row.code);
      expect({ code: row.code, orders: row.deliveredOrders, net: row.netSales }).toEqual({
        code: row.code,
        orders: mine?.orders ?? 0,
        net: mine?.net ?? 0,
      });
    }
  });

  it('shows the hand-counted figures, a code nobody took with zeros', async () => {
    const list = await owner.client.admin.promoCodes.list();
    if (list.status !== 200) throw new Error(`list ${list.status}`);
    const by = (code: string) => list.body.find((p) => p.code === code)!;
    // the fixture's hand calculation (orders 8, 14, 17; order 13): cancelled and returned orders
    // that held a use are not counted, refunds come off the net
    expect(by('BLOGER10')).toMatchObject({
      id: catalog.promoCodeId.BLOGER10,
      deliveredOrders: 3,
      netSales: 1_170_900,
    });
    expect(by('MINUS50')).toMatchObject({ deliveredOrders: 1, netSales: 130_000 });
    // never used
    expect(by('TIHO5')).toMatchObject({ deliveredOrders: 0, netSales: 0 });
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from '@lummi/db';
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

async function stats() {
  const res = await owner.client.admin.promoCodes.stats();
  if (res.status !== 200) throw new Error(`stats ${res.status}`);
  return res.body;
}

describe('promo code stats: what each code brought (#65)', () => {
  it('keeps the plain list lean: the dropdowns read it without the summary', async () => {
    const list = await owner.client.admin.promoCodes.list();
    if (list.status !== 200) throw new Error(`list ${list.status}`);
    expect(list.body).toHaveLength(3);
    for (const row of list.body) expect(Object.keys(row)).not.toContain('netSales');
  });

  it('equals the marketing report for the same code over its life', async () => {
    const rows = await stats();
    expect(rows).toHaveLength(3);
    const codes = await owner.client.admin.promoCodes.list();
    if (codes.status !== 200) throw new Error(`list ${codes.status}`);
    for (const row of rows) {
      expect(row).toMatchObject({ statsFrom: '2026-11-07', statsTo: '2026-11-15' });
      expect(row.reportFrom).toBe(row.statsFrom);
      const code = codes.body.find((c) => c.id === row.promoCodeId)!.code;
      const res = await owner.client.admin.reports.marketing({
        query: { from: row.statsFrom, to: row.statsTo, code },
      });
      if (res.status !== 200) throw new Error(`report ${res.status}`);
      const mine = res.body.promoCodes.find((p) => p.code === code);
      expect({ code, orders: row.fulfilledOrders, net: row.netSales }).toEqual({
        code,
        orders: mine?.orders ?? 0,
        net: mine?.net ?? 0,
      });
    }
  });

  it('shows the hand-counted figures, a code nobody took with zeros', async () => {
    const rows = await stats();
    const by = (id: number) => rows.find((p) => p.promoCodeId === id)!;
    // the fixture's hand calculation (orders 8, 14, 17; order 13): cancelled and returned orders
    // that held a use are not counted, refunds come off the net
    expect(by(catalog.promoCodeId.BLOGER10)).toMatchObject({
      fulfilledOrders: 3,
      netSales: 1_170_900,
    });
    expect(by(catalog.promoCodeId.MINUS50)).toMatchObject({
      fulfilledOrders: 1,
      netSales: 130_000,
    });
    expect(by(catalog.promoCodeId.TIHO5)).toMatchObject({ fulfilledOrders: 0, netSales: 0 });
  });

  it('counts a whole life past the report range; the link starts at the latest allowed day', async () => {
    // TIHO5 made 1 Sep 2025 (441 days before 15 Nov 2026) took a delivered order of 5 Sep 2025
    const {
      rows: [row],
    } = await t.db.execute<{ id: number; items: number }>(sql`
      select o.id, o.items_subtotal - o.discount_amount
        - coalesce((select sum(r.amount) from refunds r where r.order_id = o.id), 0) as items from orders o
      where o.status = 'delivered'
        and not exists (select 1 from promo_code_uses u where u.order_id = o.id)
      order by o.id limit 1`);
    await t.db.execute(sql`update promo_codes set created_at = '2025-09-01T05:00:00Z'
      where id = ${catalog.promoCodeId.TIHO5}`);
    await t.db.execute(sql`insert into promo_code_uses (promo_code_id, order_id, customer_id)
      select ${catalog.promoCodeId.TIHO5}, o.id, o.customer_id from orders o where o.id = ${row!.id}`);
    await t.db.execute(sql`update order_events set created_at = '2025-09-05T08:00:00Z'
      where order_id = ${row!.id} and to_status = 'delivered'`);
    const rows = await stats();
    const old = rows.find((p) => p.promoCodeId === catalog.promoCodeId.TIHO5)!;
    expect(old).toMatchObject({
      fulfilledOrders: 1,
      netSales: Number(row!.items),
      statsFrom: '2025-09-01',
      statsTo: '2026-11-15',
      reportFrom: '2025-11-15',
    });
    // a younger code starts on its own creation day
    expect(rows.find((p) => p.promoCodeId === catalog.promoCodeId.BLOGER10)!.statsFrom).toBe(
      '2026-11-07',
    );
  });
});

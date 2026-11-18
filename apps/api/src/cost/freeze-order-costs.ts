import type { OrderCostSnapshot } from '@lummi/contracts';
import {
  and,
  asc,
  eq,
  fragrances,
  inArray,
  isNull,
  orderEvents,
  orderLines,
  orders,
  sql,
  type Db,
  type DbOrTx,
  type OrderLineRow,
  type OrderRow,
} from '@lummi/db';
import { readCostSettings } from './cost-settings';
import { PAID_BY } from '../orders/order-read';
import { lineUnitCost, saleProfit, type CostedItem } from './order-costs';
import type { CostSettings } from './unit-cost';

/** What a line is, for its unit cost: its bottle, or its set's five fragrances at the vial size. */
export function costedItemOf(
  l: Pick<OrderLineRow, 'kind' | 'fragranceId' | 'ml' | 'setComposition'>,
): CostedItem | null {
  if (l.kind === 'volume')
    return l.fragranceId === null ? null : { kind: 'volume', fragranceId: l.fragranceId, ml: l.ml };
  return l.setComposition
    ? { kind: 'set', ml: l.ml, fragranceIds: l.setComposition.map((f) => f.fragranceId) }
    : null;
}

/**
 * An order's cost snapshot from its lines, the oil prices and the settings now (#77): each line
 * at its unit cost (a Promo gift's line too), then the order costs on the Mini App channel. Pure.
 * The goods are known only when every line's unit cost is: otherwise `profit` is null and
 * `missing` names the fragrances without an oil price (ADR 0040: no oil price, no cost); empty, a
 * line had nothing to cost (no fragrance, or a size the model has no cost for).
 */
export function orderCostSnapshot(
  order: Pick<OrderRow, 'itemsSubtotal' | 'discountAmount' | 'deliveryFee'>,
  lines: readonly Pick<OrderLineRow, 'kind' | 'fragranceId' | 'ml' | 'setComposition' | 'qty'>[],
  oil: ReadonlyMap<number, { name: string; oilPrice: number | null }>,
  s: CostSettings,
  at: Date,
): { snapshot: OrderCostSnapshot; unitCosts: (number | null)[] } {
  const missing = new Set<number>();
  const unitCosts = lines.map((l) => {
    const item = costedItemOf(l);
    if (!item) return null;
    const cost = lineUnitCost(item, (id) => oil.get(id)?.oilPrice ?? null, s);
    cost.missing.forEach((id) => missing.add(id));
    return cost.unitCost;
  });
  const known = unitCosts.every((c) => c !== null);
  const goods = known ? lines.reduce((sum, l, i) => sum + unitCosts[i]! * l.qty, 0) : null;
  return {
    snapshot: {
      at: at.toISOString(),
      profit:
        goods === null
          ? null
          : saleProfit(
              {
                channel: 'miniapp',
                revenue: order.itemsSubtotal - order.discountAmount,
                goods,
                deliveryPaid: order.deliveryFee,
                // a gift sample goes in with #79; until then no order has one
                giftSample: 0,
              },
              s,
            ),
      missing: [...missing].map((id) => oil.get(id)?.name ?? `#${id}`).sort(),
    },
    unitCosts,
  };
}

/**
 * Freezes the order's costs in the caller's transaction (the payment confirmation, the one door):
 * each line's unit cost into `order_lines.unit_cost`, the snapshot into `orders.costs`. Later oil
 * prices and settings never touch them. An order already frozen keeps its snapshot. With
 * `waitForOilPrices` (the backfill) an order a fragrance has no oil price for is left without one,
 * so a later run can still freeze it. Returns the snapshot it wrote, or null.
 */
export async function freezeOrderCosts(
  tx: DbOrTx,
  order: OrderRow,
  at: Date,
  opts: { waitForOilPrices?: boolean } = {},
): Promise<OrderCostSnapshot | null> {
  if (order.costs) return null;
  const lines = await tx
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, order.id))
    .orderBy(asc(orderLines.position));
  const ids = [
    ...new Set(
      lines.flatMap((l) => {
        const item = costedItemOf(l);
        return item ? (item.kind === 'volume' ? [item.fragranceId] : item.fragranceIds) : [];
      }),
    ),
  ];
  const rows = ids.length
    ? await tx
        .select({ id: fragrances.id, name: fragrances.name, oilPrice: fragrances.oilPrice })
        .from(fragrances)
        .where(inArray(fragrances.id, ids))
    : [];
  const oil = new Map(rows.map((r) => [r.id, { name: r.name, oilPrice: r.oilPrice }]));
  const { snapshot, unitCosts } = orderCostSnapshot(
    order,
    lines,
    oil,
    await readCostSettings(tx),
    at,
  );
  if (opts.waitForOilPrices && snapshot.missing.length > 0) return null;
  for (const [i, l] of lines.entries()) {
    if (unitCosts[i] === null) continue;
    await tx.update(orderLines).set({ unitCost: unitCosts[i] }).where(eq(orderLines.id, l.id));
  }
  await tx.update(orders).set({ costs: snapshot }).where(eq(orders.id, order.id));
  return snapshot;
}

/**
 * Orders paid before costs were recorded (#77 shipped after them) get theirs frozen now, with the
 * oil prices and settings of now: every order with a payment confirmation in its history and no
 * snapshot. One waiting for a fragrance's oil price is left for a later run (`waiting`) rather
 * than frozen without costs for good; one with a line that has nothing to cost (no fragrance) can
 * never be costed, so it is frozen without a profit once and named in `uncostable`, never retried.
 * Idempotent; run by the deploy's seed step.
 */
export async function freezeMissingOrderCosts(
  db: Db,
  now: Date,
): Promise<{ frozen: number; waiting: number; uncostable: number[] }> {
  const due = await db
    .select()
    .from(orders)
    .where(
      and(
        isNull(orders.costs),
        sql`exists (select 1 from ${orderEvents} e where e.order_id = ${orders.id} and e.action = ${PAID_BY})`,
      ),
    )
    .orderBy(asc(orders.id));
  const out = { frozen: 0, waiting: 0, uncostable: [] as number[] };
  for (const o of due) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(orders).where(eq(orders.id, o.id)).for('update');
      if (!locked) return;
      const snapshot = await freezeOrderCosts(tx, locked, now, { waitForOilPrices: true });
      if (!snapshot) out.waiting += 1;
      else if (snapshot.profit) out.frozen += 1;
      else out.uncostable.push(locked.number);
    });
  }
  return out;
}

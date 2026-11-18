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
import { lineUnitCost, orderCosts, type CostedItem } from './order-costs';
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
 * The goods are known only when every line's unit cost is: otherwise `costs` is null and
 * `missing` names the fragrances without an oil price (ADR 0040: no oil price, no cost).
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
      costs:
        goods === null
          ? null
          : orderCosts(
              {
                channel: 'miniapp',
                revenue: order.itemsSubtotal - order.discountAmount,
                goods,
                deliveryPaid: order.deliveryFee,
                // a gift sample goes in with #79; until then no order has one
                giftSample: 0,
              },
              s.order,
            ),
      missing: [...missing].map((id) => oil.get(id)?.name ?? `#${id}`).sort(),
    },
    unitCosts,
  };
}

/**
 * Freezes the order's costs in the caller's transaction (the payment confirmation, the one door):
 * each line's unit cost into `order_lines.unit_cost`, the snapshot into `orders.costs`. Later oil
 * prices and settings never touch them. An order already frozen keeps its snapshot.
 */
export async function freezeOrderCosts(tx: DbOrTx, order: OrderRow, at: Date): Promise<void> {
  if (order.costs) return;
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
  for (const [i, l] of lines.entries()) {
    if (unitCosts[i] === null) continue;
    await tx.update(orderLines).set({ unitCost: unitCosts[i] }).where(eq(orderLines.id, l.id));
  }
  await tx.update(orders).set({ costs: snapshot }).where(eq(orders.id, order.id));
}

/**
 * Orders paid before costs were recorded (#77 shipped after them) get theirs frozen now, with the
 * oil prices and settings of now: every order with a payment confirmation in its history and no
 * snapshot. Idempotent; run on deploy (`seed-staging`, the run guide). Returns how many it froze.
 */
export async function freezeMissingOrderCosts(db: Db, now: Date): Promise<number> {
  const due = await db
    .select()
    .from(orders)
    .where(
      and(
        isNull(orders.costs),
        sql`exists (select 1 from ${orderEvents} e where e.order_id = ${orders.id} and e.action = 'confirm_payment')`,
      ),
    )
    .orderBy(asc(orders.id));
  for (const o of due) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(orders).where(eq(orders.id, o.id)).for('update');
      if (locked) await freezeOrderCosts(tx, locked, now);
    });
  }
  return due.length;
}

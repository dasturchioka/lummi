import type { OrderCostSnapshot } from '@lummi/contracts';
import { lineUnitCost, saleProfit, type CostedItem } from '../cost/order-costs';
import type { CostSettings } from '../cost/unit-cost';

/** An Uzum sale's line as its cost sees it: a bottle, or the Discovery set's five 10 ml vials. */
export interface UzumCostLine {
  item: CostedItem | null;
  qty: number;
  lineTotal: number;
}

/**
 * An Uzum sale's cost snapshot (#80), the order's own arithmetic (#77) on the Uzum channel: each
 * line at its unit cost (ADR 0040), then `saleProfit` with the sale's own commission, no mailer and
 * no delivery, one ad and the tax on its revenue. Pure. No oil price, no cost: `profit` is null and
 * `missing` names the fragrances without one; a line with nothing to cost (the Discovery set
 * without its five) leaves `missing` empty.
 */
export function uzumSaleCosts(
  lines: readonly UzumCostLine[],
  commissionPercent: number,
  oil: ReadonlyMap<number, { name: string; oilPrice: number | null }>,
  s: CostSettings,
  at: Date,
): { snapshot: OrderCostSnapshot; unitCosts: (number | null)[] } {
  const missing = new Set<number>();
  const unitCosts = lines.map((l) => {
    if (!l.item) return null;
    const cost = lineUnitCost(l.item, (id) => oil.get(id)?.oilPrice ?? null, s);
    cost.missing.forEach((id) => missing.add(id));
    return cost.unitCost;
  });
  const known = unitCosts.every((c) => c !== null);
  const goods = known ? lines.reduce((sum, l, i) => sum + unitCosts[i]! * l.qty, 0) : null;
  const revenue = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const settings: CostSettings = {
    ...s,
    order: { ...s.order, uzumCommissionPercent: commissionPercent },
  };
  return {
    snapshot: {
      at: at.toISOString(),
      profit:
        goods === null
          ? null
          : saleProfit(
              { channel: 'uzum', revenue, goods, deliveryPaid: 0, giftSample: 0 },
              settings,
            ),
      missing: [...missing].map((id) => oil.get(id)?.name ?? `#${id}`).sort(),
    },
    unitCosts,
  };
}

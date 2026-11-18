import type { OrderCosts, SalesChannel } from '@lummi/contracts';
import {
  bottleCost,
  isBottleMl,
  orderCosts,
  setCost,
  som,
  type CostSettings,
  type SetVialMl,
} from './unit-cost';

/**
 * Order profit (#77) on the cost model's one `orderCosts` (the calculator's, ADR 0040): the order
 * freezes it when its payment is confirmed (`freezeOrderCosts`); the «Рентабельность» page runs it
 * on sales it makes up. Pure: the caller brings the figures and the settings.
 */
export interface SaleCostInput {
  channel: SalesChannel;
  /** Items less the discount, whole so'm; delivery is not in it. */
  revenue: number;
  /** The goods at unit cost (each line's unit cost total × quantity), whole so'm. */
  goods: number;
  /** What the customer actually paid for delivery (Mini App), decided by the order or `quote()`. */
  deliveryPaid: number;
  /** A gift sample's cost when one went in, else 0. */
  giftSample: number;
}

/**
 * A sale's costs and profit in whole so'm: `orderCosts` (mailer, BTS less the delivery the customer
 * paid, online payment or Uzum commission, ad, tax, gift sample) with the delivery fee the order
 * really has, not the calculator's guess from the threshold. Each figure is rounded to whole so'm
 * half up; `total` is the unrounded total rounded (ADR 0040's rule: the parts may differ from it by
 * a so'm), profit = revenue − total, so the figures the owner reads add up to the profit.
 */
export function saleCosts(input: SaleCostInput, s: CostSettings): OrderCosts {
  const app = input.channel === 'miniapp';
  const raw = orderCosts({
    revenue: input.revenue,
    goods: input.goods,
    channel: app ? 'app' : 'uzum',
    giftSample: input.giftSample,
    // the fee is the order's own: never «free from» a threshold here, the order already decided
    delivery: { freeFrom: Number.POSITIVE_INFINITY, customerFee: app ? input.deliveryPaid : 0 },
    settings: s,
  });
  const total = som(raw.total);
  const profit = input.revenue - total;
  return {
    channel: input.channel,
    revenue: input.revenue,
    goods: input.goods,
    mailer: som(raw.mailer),
    btsCharge: app ? s.order.btsCharge : 0,
    deliveryPaid: app ? input.deliveryPaid : 0,
    commissionPercent: app ? s.order.onlinePaymentPercent : s.order.uzumCommissionPercent,
    commission: som(raw.commission),
    adPerSale: som(raw.ad),
    taxPercent: s.order.taxPercent,
    tax: som(raw.tax),
    giftSample: som(raw.gift),
    total,
    profit,
    margin: input.revenue > 0 ? profit / input.revenue : null,
  };
}

/** What a line sells, for its unit cost: a bottle, or a set's five vials of `ml`. */
export type CostedItem =
  | { kind: 'volume'; fragranceId: number; ml: number }
  | { kind: 'set'; ml: number; fragranceIds: readonly number[] };

/**
 * One unit of a line at unit cost (ADR 0040): a bottle's `bottleCost`, a set's `setCost` over its
 * five fragrances. No oil price, no cost: `unitCost` is null and `missing` names the fragrances
 * without one. A volume or vial size the model has no cost for has none either (never a throw:
 * costing must not stop a payment's confirmation).
 */
export function lineUnitCost(
  item: CostedItem,
  oilPriceOf: (fragranceId: number) => number | null,
  s: CostSettings,
): { unitCost: number | null; missing: number[] } {
  const ids = item.kind === 'volume' ? [item.fragranceId] : [...item.fragranceIds];
  const prices = ids.map(oilPriceOf);
  const missing = ids.filter((_, i) => prices[i] === null);
  if (missing.length > 0) return { unitCost: null, missing };
  const known = prices as number[];
  if (item.kind === 'volume') {
    return {
      unitCost: isBottleMl(item.ml) ? bottleCost(known[0]!, item.ml, s).total : null,
      missing,
    };
  }
  return {
    unitCost: isSetVialMl(item.ml) ? setCost(known, item.ml, s).total : null,
    missing,
  };
}

const isSetVialMl = (ml: number): ml is SetVialMl => ml === 5 || ml === 10;

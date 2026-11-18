import type { OrderCosts, SalesChannel } from '@lummi/contracts';
import {
  bottleCost,
  isBottleMl,
  setCost,
  som,
  type CostSettings,
  type OrderCostSettings,
  type SetVialMl,
} from './unit-cost';

/**
 * Order profit (#77): the customer's calculator's `orderCosts`, on whole so'm. The order freezes
 * it when its payment is confirmed (`freezeOrderCosts`); the «Рентабельность» page runs it on
 * sales it makes up. Pure: the caller brings the figures and the settings.
 */
export interface OrderCostInput {
  channel: SalesChannel;
  /** Items less the discount, whole so'm; delivery is not in it. */
  revenue: number;
  /** The goods at unit cost (each line's unit cost total × quantity), whole so'm. */
  goods: number;
  /** What the customer paid for delivery (Mini App); Uzum has none. */
  deliveryPaid: number;
  /** A gift sample's cost when one went in, else 0. */
  giftSample: number;
}

/**
 * The calculator's order costs: on the Mini App the BTS mailer, BTS's charge less what the
 * customer paid for delivery (below zero when they paid more) and the online-payment % of revenue;
 * on Uzum its commission % instead, without mailer or delivery; on both the ad per sale, the tax %
 * of revenue and the gift sample. Each percentage is rounded to whole so'm on its own, half up,
 * so the figures shown add up to the total; profit = revenue − total, margin = profit ÷ revenue.
 */
export function orderCosts(input: OrderCostInput, s: OrderCostSettings): OrderCosts {
  const app = input.channel === 'miniapp';
  const mailer = app ? s.mailer : 0;
  const btsCharge = app ? s.btsCharge : 0;
  const deliveryPaid = app ? input.deliveryPaid : 0;
  const commissionPercent = app ? s.onlinePaymentPercent : s.uzumCommissionPercent;
  const commission = som((input.revenue * commissionPercent) / 100);
  const tax = som((input.revenue * s.taxPercent) / 100);
  const total =
    input.goods +
    mailer +
    (btsCharge - deliveryPaid) +
    commission +
    s.adPerSale +
    tax +
    input.giftSample;
  const profit = input.revenue - total;
  return {
    channel: input.channel,
    revenue: input.revenue,
    goods: input.goods,
    mailer,
    btsCharge,
    deliveryPaid,
    commissionPercent,
    commission,
    adPerSale: s.adPerSale,
    taxPercent: s.taxPercent,
    tax,
    giftSample: input.giftSample,
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

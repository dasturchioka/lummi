import type { FragranceCosts, VolumeCost } from '@lummi/contracts';
import { activeMarkdown, volumePrice } from '../pricing/quote';
import { bottleCost, isBottleMl, landedOilPrice, som, type CostSettings } from './unit-cost';

/**
 * The catalog page's cost block (ADR 0040): each volume's unit cost against its price and, while
 * one is active, its markdown price. Profit here is price less unit cost, before any order costs
 * (mailer, delivery, ads, tax): those belong to an order (#77). No oil price, no cost. Rounding
 * is the model's one rule (`som`).
 */
export function fragranceCosts(
  oilPrice: number | null,
  vols: readonly { ml: number; price: number; salePrice: number | null; saleEndsAt: Date | null }[],
  s: CostSettings,
  now: Date,
): FragranceCosts {
  const volumes = vols.map((v): VolumeCost => {
    const cost = oilPrice === null || !isBottleMl(v.ml) ? null : bottleCost(oilPrice, v.ml, s);
    const markdownPrice = activeMarkdown(volumePrice(v), now);
    const profit = (price: number | null) =>
      cost === null || price === null ? null : price - cost.total;
    const margin = (price: number | null) => {
      const p = profit(price);
      return p === null || !price ? null : p / price;
    };
    return {
      ml: v.ml,
      price: v.price,
      markdownPrice,
      cost,
      profit: profit(v.price),
      margin: margin(v.price),
      markdownProfit: profit(markdownPrice),
      markdownMargin: margin(markdownPrice),
    };
  });
  return {
    oilPrice,
    landedOilPrice: oilPrice === null ? null : som(landedOilPrice(oilPrice, s.liquid)),
    volumes,
  };
}

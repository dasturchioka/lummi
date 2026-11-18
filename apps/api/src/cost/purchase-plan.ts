import type { PurchasePlan, PurchasePlanRow } from '@lummi/contracts';
import {
  bottleCostExact,
  giftSampleCostExact,
  landedOilPrice,
  orderCosts,
  som,
  type SaleChannel,
  type BottleMl,
  type CostSettings,
} from './unit-cost';

/**
 * The purchase planner (#78): the customer's `buyCalc` as one pure function (ADR 0040). It costs
 * a bottle with the cost model (`bottleCostExact`, `giftSampleCostExact`, `landedOilPrice`), never
 * with a formula of its own; what is its own is the purchase arithmetic: how much perfume the oil
 * makes, how it splits into bottles, and what each bottle sold as a single order earns.
 *
 * Unlike the calculator, which prices every fragrance at one list price, each fragrance sells at
 * its own catalog price; a volume it has no price for is not filled. Money is computed unrounded
 * and each figure rounded once at the end (`som`).
 */

export const PLAN_VOLUMES = [10, 30, 50] as const satisfies readonly BottleMl[];
type PlanMl = (typeof PLAN_VOLUMES)[number];

/** The `buy.*` settings plus the settings of the other areas the plan reads. */
export interface PlanSettings {
  /** Percent shares of the liquid filled into 10 / 30 / 50 ml; they need not sum to 100. */
  shares: Record<PlanMl, number>;
  avgDiscountPercent: number;
  uzumSharePercent: number;
  soldPercent: number;
  staffCount: number;
  staffSalary: number;
  rent: number;
  otherUsdPerMonth: number;
  /** Pricing's free-delivery threshold: a single order below it pays the delivery fee. */
  freeDeliveryThreshold: number;
  /** What the customer pays for delivery below the threshold (the default tariff). */
  customerDeliveryFee: number;
}

export interface PlanFragrance {
  id: number;
  name: string;
  brand: string;
  /** So'm per gram on the invoice, before the supplier discount. */
  oilPrice: number;
  /** The catalog price of each volume the fragrance has. */
  prices: Partial<Record<PlanMl, number>>;
  oilKg: number;
  overridden: boolean;
}

export function planPurchase(
  fragrances: readonly PlanFragrance[],
  p: PlanSettings,
  s: CostSettings,
  defaultKg: number,
  withoutOilPrice: PurchasePlan['withoutOilPrice'] = [],
): PurchasePlan {
  const { liquid: l, order: o } = s;
  /** Ml of perfume one kg of oil makes, the filling loss taken off. */
  const perfumeMlPerKgOfOil = l.oilPercent > 0 ? (1000 / (l.oilPercent / 100)) * l.oilDensity : 0;
  const perfumeMlPerKg = perfumeMlPerKgOfOil * (1 - l.fillingLossPercent / 100);
  const shareSum = p.shares[10] + p.shares[30] + p.shares[50] || 1;
  const n = fragrances.length;
  const giftMl = o.giftSampleCount * o.giftSampleMl;
  const giftPerFragranceMl = n === 0 ? 0 : giftMl / n;
  const discount = p.avgDiscountPercent / 100;
  const uzum = p.uzumSharePercent / 100;

  let oilInvestment = 0;
  let ethanolInvestment = 0;
  let perfumeMl = 0;
  const bottles = { 10: 0, 30: 0, 50: 0 } as Record<PlanMl, number>;
  let revenueFull = 0;
  let revenueNet = 0;
  let profit = 0;
  let liquidInSold = 0;
  const rows: PurchasePlanRow[] = [];

  for (const f of fragrances) {
    const oilCost = landedOilPrice(f.oilPrice, l) * 1000 * f.oilKg;
    oilInvestment += oilCost;
    perfumeMl += perfumeMlPerKg * f.oilKg;
    // ethanol is bought for the perfume's whole volume, before the filling loss
    ethanolInvestment +=
      (perfumeMlPerKgOfOil * f.oilKg * (l.ethanolPercent / 100) * l.ethanolPerLitre) / 1000;
    const fillable = Math.max(0, perfumeMlPerKg * f.oilKg - giftPerFragranceMl);
    let rowBottles = 0;
    let rowRevenue = 0;
    let rowProfit = 0;
    for (const ml of PLAN_VOLUMES) {
      const full = f.prices[ml];
      const count = Math.floor((fillable * (p.shares[ml] / shareSum)) / ml);
      if (full === undefined || !count) continue;
      bottles[ml] += count;
      rowBottles += count;
      const unit = bottleCostExact(f.oilPrice, ml, s);
      const net = full * (1 - discount);
      // each bottle is an order of its own, on the Mini App or on Uzum
      const profitOn = (channel: SaleChannel) =>
        orderCosts({
          revenue: net,
          goods: unit.total,
          channel,
          delivery: { freeFrom: p.freeDeliveryThreshold, customerFee: p.customerDeliveryFee },
          settings: s,
        }).profit;
      const one = profitOn('app') * (1 - uzum) + profitOn('uzum') * uzum;
      revenueFull += full * count;
      revenueNet += net * count;
      rowRevenue += net * count;
      profit += one * count;
      rowProfit += one * count;
      liquidInSold += unit.liquid * (1 + s.packaging.defectPercent / 100) * count;
    }
    rows.push({
      fragranceId: f.id,
      name: f.name,
      brand: f.brand,
      oilKg: f.oilKg,
      overridden: f.overridden,
      oilCost: som(oilCost),
      bottles: rowBottles,
      revenue: som(rowRevenue),
      profit: som(rowProfit),
    });
  }

  const giftUnit = giftSampleCostExact(
    fragrances.map((f) => f.oilPrice),
    s,
  );
  const giftTotal = (giftUnit ?? 0) * o.giftSampleCount;
  profit -= giftTotal;
  const units = bottles[10] + bottles[30] + bottles[50];
  const liquidInvestment = oilInvestment + ethanolInvestment;
  /** What one bottle earns before the liquid in it, which the purchase has already paid for. */
  const contribution = units === 0 ? 0 : (profit + giftTotal + liquidInSold) / units;
  const paybackUnits =
    contribution > 0 ? Math.ceil((liquidInvestment + giftTotal) / contribution) : null;

  const sold = p.soldPercent / 100;
  const fixedPerMonth = p.staffCount * p.staffSalary + p.rent + p.otherUsdPerMonth * l.usdRate;
  const fixedCosts = fixedPerMonth * 12;
  const yearProfit = (profit + giftTotal) * sold - giftTotal;
  const net = yearProfit - fixedCosts;

  rows.sort((a, b) => b.profit - a.profit);
  return {
    inputs: {
      oilKgPerFragrance: defaultKg,
      shares: { ml10: p.shares[10], ml30: p.shares[30], ml50: p.shares[50] },
      avgDiscountPercent: p.avgDiscountPercent,
      uzumSharePercent: p.uzumSharePercent,
      soldPercent: p.soldPercent,
      giftSampleCount: o.giftSampleCount,
      giftSampleMl: o.giftSampleMl,
      fixedPerMonth: som(fixedPerMonth),
    },
    fragranceCount: n,
    investment: {
      oil: som(oilInvestment),
      ethanol: som(ethanolInvestment),
      total: som(liquidInvestment),
    },
    liquid: { perfumeMl: som(perfumeMl), giftMl: som(giftMl) },
    bottles: { ml10: bottles[10], ml30: bottles[30], ml50: bottles[50], total: units },
    revenue: {
      full: som(revenueFull),
      discount: som(revenueFull - revenueNet),
      net: som(revenueNet),
    },
    gift: { unitCost: som(giftUnit ?? 0), total: som(giftTotal) },
    profit: som(profit),
    margin: revenueNet ? profit / revenueNet : null,
    payback: {
      units: paybackUnits,
      share: paybackUnits === null || units === 0 ? null : paybackUnits / units,
    },
    year: {
      soldBottles: Math.round(units * sold),
      revenue: som(revenueNet * sold),
      profit: som(yearProfit),
      fixedCosts: som(fixedCosts),
      net: som(net),
      netPerMonth: som(net / 12),
      stockAtCost: som(Math.max(0, liquidInvestment * (1 - sold))),
    },
    rows,
    withoutOilPrice,
  };
}

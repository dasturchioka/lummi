import type { StockLevel } from '@lummi/contracts';
import { landedOilPrice, mixNeeds, UL_PER_ML, type LiquidSettings } from '../cost/unit-cost';

/**
 * The warehouse's arithmetic (ADR 0041, 0043), pure. Oil is kept in whole milligrams and the ready
 * concentrate in whole microlitres, so fractions add up exactly; the API speaks grams and ml. What
 * a mixing uses up is the cost model's `mixNeeds` (ADR 0040), never a second formula.
 */

export const MG_PER_GRAM = 1000;
export const mgFromGrams = (grams: number) => Math.round(grams * MG_PER_GRAM);
export const gramsFromMg = (mg: number) => mg / MG_PER_GRAM;
export const ulFromMl = (ml: number) => Math.round(ml * UL_PER_ML);
export const mlFromUl = (ul: number) => ul / UL_PER_ML;

/**
 * The oil (mg) and ethanol (whole ml) mixing `ml` of ready concentrate takes: the cost model's
 * shares without the filling loss, each rounded once, half up.
 */
export function mixingNeeds(ml: number, l: LiquidSettings): { oilMg: number; ethanolMl: number } {
  const need = mixNeeds(ml, l);
  return { oilMg: mgFromGrams(need.oilGrams), ethanolMl: Math.round(need.ethanolMl) };
}

/** Ml of oil in `grams`, by the oil density setting. */
export const oilMlOf = (grams: number, l: Pick<LiquidSettings, 'oilDensity'>) =>
  l.oilDensity > 0 ? grams / l.oilDensity : 0;

/**
 * The low-oil warning: none left, at or under the `stock.lowOilMl` setting (ml of oil), or fine. A
 * threshold of 0 warns only when nothing is left.
 */
export function oilLevel(oilMl: number, lowMl: number): StockLevel {
  if (oilMl <= 0) return 'zero';
  return oilMl <= lowMl ? 'low' : 'ok';
}

/**
 * The low-concentrate warning (ADR 0043): none while the free concentrate can't fill the smallest
 * bottle sold (`smallestFillUl`), at or under the `stock.lowConcentrateMl` setting, or fine.
 */
export function concentrateLevel(
  freeUl: number,
  smallestFillUl: number,
  lowMl: number,
): StockLevel {
  if (freeUl < smallestFillUl) return 'zero';
  return freeUl <= ulFromMl(lowMl) ? 'low' : 'ok';
}

/** What an oil receipt's oil cost, as typed from the invoice. */
export interface OilReceiptPrice {
  oilMg: number;
  /** So'm per gram before the supplier discount. */
  pricePerGram: number;
  discountPercent: number;
  /** The delivery to Termez, percent of the discounted price. */
  importPercent: number;
}

const landed = (r: OilReceiptPrice) =>
  landedOilPrice(r.pricePerGram, {
    oilDiscountPercent: r.discountPercent,
    oilImportPercent: r.importPercent,
  });

/** An oil receipt's landed so'm per gram and its total, each rounded once from the unrounded price. */
export function oilReceiptCost(r: OilReceiptPrice): { landedPerGram: number; total: number } {
  const perGram = landed(r);
  return {
    landedPerGram: Math.round(perGram),
    total: Math.round(perGram * gramsFromMg(r.oilMg)),
  };
}

/**
 * The oil balance at cost: the balance at the average landed price of the oil receipts still
 * standing (each weighted by its grams). Whole so'm.
 */
export function oilValue(balanceMg: number, oilReceipts: readonly OilReceiptPrice[]): number {
  if (balanceMg <= 0) return 0;
  const grams = oilReceipts.reduce((a, r) => a + gramsFromMg(r.oilMg), 0);
  if (grams <= 0) return 0;
  const cost = oilReceipts.reduce((a, r) => a + landed(r) * gramsFromMg(r.oilMg), 0);
  return Math.round((cost / grams) * gramsFromMg(balanceMg));
}

import type { StockLevel } from '@lummi/contracts';
import { landedOilPrice, liquidNeeded, type LiquidSettings } from '../cost/unit-cost';

/**
 * The warehouse's arithmetic (ADR 0041), pure. Oil is kept in whole milligrams, so a bottling's
 * fractions of a gram add up exactly; the API speaks grams. What a fill uses up is the cost model's
 * `liquidNeeded` (ADR 0040), never a second formula.
 */

export const MG_PER_GRAM = 1000;
export const mgFromGrams = (grams: number) => Math.round(grams * MG_PER_GRAM);
export const gramsFromMg = (mg: number) => mg / MG_PER_GRAM;

/** One volume of a bottling: how many bottles of that size. */
export interface BottlingLine {
  ml: number;
  quantity: number;
}

/**
 * The oil (mg) and ethanol (ml) a bottling uses up, the filling loss included: each line's
 * `liquidNeeded` times its count, summed unrounded and rounded once, half up. Ethanol is costed,
 * not stocked: the figure is for the record.
 */
export function bottlingNeeds(
  lines: readonly BottlingLine[],
  l: LiquidSettings,
): { oilMg: number; ethanolMl: number } {
  let oilGrams = 0;
  let ethanolMl = 0;
  for (const { ml, quantity } of lines) {
    const each = liquidNeeded(ml, l);
    oilGrams += each.oilGrams * quantity;
    ethanolMl += each.ethanolMl * quantity;
  }
  return { oilMg: mgFromGrams(oilGrams), ethanolMl: Math.round(ethanolMl) };
}

/**
 * The low-oil warning: none left, at or under the `stock.lowOilLitres` setting (litres of
 * perfume the oil still makes), or fine. A threshold of 0 warns only when nothing is left.
 */
export function oilLevel(litres: number, lowLitres: number): StockLevel {
  if (litres <= 0) return 'zero';
  return litres <= lowLitres ? 'low' : 'ok';
}

/** What a receipt's oil cost, as typed from the invoice. */
export interface ReceiptPrice {
  oilMg: number;
  /** So'm per gram before the supplier discount. */
  pricePerGram: number;
  discountPercent: number;
  /** The delivery to Termez, percent of the discounted price. */
  importPercent: number;
}

const landed = (r: ReceiptPrice) =>
  landedOilPrice(r.pricePerGram, {
    oilDiscountPercent: r.discountPercent,
    oilImportPercent: r.importPercent,
  });

/** A receipt's landed so'm per gram and its total, each rounded once from the unrounded price. */
export function receiptCost(r: ReceiptPrice): { landedPerGram: number; total: number } {
  const perGram = landed(r);
  return {
    landedPerGram: Math.round(perGram),
    total: Math.round(perGram * gramsFromMg(r.oilMg)),
  };
}

/**
 * The oil balance at cost: the balance at the average landed price of the receipts still
 * standing (each weighted by its grams). Whole so'm.
 */
export function oilValue(balanceMg: number, receipts: readonly ReceiptPrice[]): number {
  if (balanceMg <= 0) return 0;
  const grams = receipts.reduce((a, r) => a + gramsFromMg(r.oilMg), 0);
  if (grams <= 0) return 0;
  const cost = receipts.reduce((a, r) => a + landed(r) * gramsFromMg(r.oilMg), 0);
  return Math.round((cost / grams) * gramsFromMg(balanceMg));
}

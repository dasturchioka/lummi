import type { StepUp, VolumeCard } from '@lummi/contracts';

/** What the step-up reads of a volume card: its size, the price to pay now, what is left. */
type Offered = Pick<VolumeCard, 'ml' | 'effectivePrice' | 'available'>;

/** The saving is shown in whole thousands, rounded down, so it never says more than is true. */
const SHOWN_IN = 1_000;

/**
 * The Step-ups (GLOSSARY) of one fragrance: for each volume that can be bought, the next larger
 * volume that can be bought too, with what the customer saves by taking it («30 ml olsangiz,
 * 58 000 soʻm tejaysiz», #57, #60).
 *
 * The saving is measured against the customer's own choice: the bigger volume priced at the
 * chosen volume's price per ml, less the bigger volume's price.
 * - 10 → 30 ml: 3 × 69 000 = 207 000 against 149 000, so 58 000 (28 %).
 * - 30 → 50 ml: 149 000 / 30 × 50 = 248 333 against 219 000, so 29 333, shown as 29 000 (11 %).
 *
 * It is offered when that saving is at least `minPercent` of the bigger volume at the chosen rate.
 * Effective prices, so a markdown counts; personal discounts (rights, coupons) do not.
 *
 * Exact integer arithmetic. With `gap = fromPrice · toMl − toPrice · fromMl` (the saving times
 * `fromMl`), the threshold is `100 · gap ≥ minPercent · fromPrice · toMl`, and the shown saving
 * is `gap / fromMl` rounded down to whole thousands.
 */
export function stepUps(volumes: readonly Offered[], minPercent: number): StepUp[] {
  const open = volumes.filter((v) => v.available > 0).sort((a, b) => a.ml - b.ml);
  const offers: StepUp[] = [];
  for (const [i, from] of open.entries()) {
    const to = open[i + 1];
    if (!to || from.effectivePrice <= 0) continue;
    const atChosenRate = from.effectivePrice * to.ml;
    const gap = atChosenRate - to.effectivePrice * from.ml;
    if (gap <= 0 || 100 * gap < minPercent * atChosenRate) continue;
    const saving = Math.floor(gap / (from.ml * SHOWN_IN)) * SHOWN_IN;
    if (saving <= 0) continue;
    offers.push({ fromMl: from.ml, toMl: to.ml, saving });
  }
  return offers;
}

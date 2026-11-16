import type { StepUp, VolumeCard } from '@lummi/contracts';

/** What the step-up reads of a volume card: its size, the price to pay now, what is left. */
type Offered = Pick<VolumeCard, 'ml' | 'effectivePrice' | 'available'>;

/**
 * The Step-ups (GLOSSARY) of one fragrance: for each volume that can be bought, the next larger
 * volume that can be bought too, when its extra millilitres cost at least `minPercent` less per ml
 * than the smaller volume's own («+70 000 сум — и на 20 мл больше», #57). Effective prices, so a
 * markdown counts; personal discounts (rights, coupons) do not, the cart shows those.
 *
 * Exact integer arithmetic: the saving per ml is
 * `1 − (extra / extraMl) / (fromPrice / fromMl)`, compared as
 * `100 · (extraMl · fromPrice − extra · fromMl) ≥ minPercent · extraMl · fromPrice`, so it is
 * never rounded up into an offer. A larger volume that costs the same or less is not a step-up:
 * «+0 сум» is no nudge, and its tile already shows the price.
 */
export function stepUps(volumes: readonly Offered[], minPercent: number): StepUp[] {
  const open = volumes.filter((v) => v.available > 0).sort((a, b) => a.ml - b.ml);
  const offers: StepUp[] = [];
  for (const [i, from] of open.entries()) {
    const to = open[i + 1];
    if (!to || from.effectivePrice <= 0) continue;
    const extra = to.effectivePrice - from.effectivePrice;
    if (extra <= 0) continue;
    const extraMl = to.ml - from.ml;
    const whole = extraMl * from.effectivePrice;
    if (100 * (whole - extra * from.ml) < minPercent * whole) continue;
    offers.push({ fromMl: from.ml, toMl: to.ml, extra });
  }
  return offers;
}

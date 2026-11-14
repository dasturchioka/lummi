import type { Discount } from '@lummi/contracts';

/** What a line needs for its share: its place in the order, its total and its markdown flag. */
export interface ShareLine {
  position: number;
  lineTotal: number;
  markedDown: boolean;
}

/**
 * How an order's one Discount (its snapshot) is shared over its lines, so a fragrance's net is its
 * lines' totals less their shares (#42). The shares always add up to the discount exactly.
 *
 * - An upgrade right discounts one unit of the line it names (`lineKey`, the line's position,
 *   ADR 0007): the whole amount sits on that line.
 * - A birthday coupon or a promo code is shared over the lines it could discount: those not
 *   marked down (ADR 0008), or every line when all are. Each gets `amount × lineTotal ÷ base`
 *   rounded down, and the so'm left over go one each to the largest remainders, the earlier line
 *   first on a tie (the largest remainder method). The snapshot does not record whether a code
 *   or the setting let the discount reach marked-down lines, so they are left out: when one did,
 *   a fragrance's net may take a share that was another line's; the totals stay exact.
 *
 * A snapshot that cannot hold (a right naming no line, a discount on lines that cost nothing)
 * throws rather than guess.
 */
export function discountShares(
  lines: readonly ShareLine[],
  discount: Discount | null,
  amount: number,
): number[] {
  const shares = lines.map(() => 0);
  if (amount === 0 || lines.length === 0) return shares;

  if (discount?.type === 'upgrade_right') {
    const at = lines.findIndex((l) => String(l.position) === discount.lineKey);
    if (at < 0) throw new Error(`an upgrade right on line ${discount.lineKey}, which is not there`);
    shares[at] = amount;
    return shares;
  }

  const eligible = lines.some((l) => !l.markedDown && l.lineTotal > 0)
    ? lines.map((l) => !l.markedDown)
    : lines.map(() => true);
  const base = BigInt(lines.reduce((s, l, i) => s + (eligible[i] ? l.lineTotal : 0), 0));
  if (base === 0n) throw new Error(`a discount of ${amount} on lines that cost nothing`);

  const whole = BigInt(amount);
  const remainders: { index: number; rest: bigint }[] = [];
  let given = 0n;
  lines.forEach((l, i) => {
    if (!eligible[i]) return;
    const exact = whole * BigInt(l.lineTotal);
    const share = exact / base;
    shares[i] = Number(share);
    given += share;
    remainders.push({ index: i, rest: exact % base });
  });
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  // fewer so'm are left than lines took a share, so each gets at most one
  remainders.slice(0, Number(whole - given)).forEach(({ index }) => {
    shares[index] = shares[index]! + 1;
  });
  return shares;
}

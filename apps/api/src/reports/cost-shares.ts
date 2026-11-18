/**
 * Shares a whole `amount` of so'm over lines by their `weights` (non-negative whole numbers), so a
 * report row can carry its part of an order's costs (#77). Each line gets `amount × weight ÷ Σ`
 * rounded toward zero; the so'm left over go one each to the largest remainders, the earlier line
 * first on a tie (the largest remainder method, as `discountShares`). The shares always add up to
 * `amount` exactly; a negative amount is shared by its size and keeps its sign. With no weight at
 * all (an order that brought in nothing) the first line takes it all.
 */
export function sharedBy(amount: number, weights: readonly number[]): number[] {
  const shares = weights.map(() => 0);
  if (amount === 0 || weights.length === 0) return shares;
  const sign = amount < 0 ? -1 : 1;
  const whole = BigInt(Math.abs(amount));
  const base = BigInt(weights.reduce((s, w) => s + w, 0));
  if (base === 0n) {
    shares[0] = amount;
    return shares;
  }
  const remainders: { index: number; rest: bigint }[] = [];
  let given = 0n;
  weights.forEach((w, i) => {
    const exact = whole * BigInt(w);
    const share = exact / base;
    shares[i] = Number(share);
    given += share;
    remainders.push({ index: i, rest: exact % base });
  });
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  remainders.slice(0, Number(whole - given)).forEach(({ index }) => {
    shares[index] = shares[index]! + 1;
  });
  return shares.map((s) => (s === 0 ? 0 : s * sign));
}

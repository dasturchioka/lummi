/**
 * The Luhn check digit that card numbers carry: a slip of one digit, or two neighbours swapped,
 * fails it. The shop card editor only warns on a failure; it never refuses the card.
 */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

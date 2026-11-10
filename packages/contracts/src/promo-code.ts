/**
 * How every promo code is read, typed or saved (ticket #29). Zod-free, so the Mini App can use
 * it through `@lummi/contracts/constants` (ADR 0030).
 */

/** Latin letters, digits, `-` and `_`: what a shopper can type on any keyboard layout without lookalikes. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** Upper-case Cyrillic letters a Russian layout gives in place of their Latin twins. */
const LATIN_TWIN: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
};

/**
 * A code as it is stored and matched: NFKC (full-width and styled forms become plain), every
 * space gone (inside too), upper-case, and the Cyrillic look-alikes folded to Latin, so a code
 * pasted from a blogger's post or typed on a Russian layout still matches. Whatever has no Latin
 * twin stays, and `PROMO_CODE_PATTERN` refuses it.
 */
export function normalizePromoCode(typed: string): string {
  return typed
    .normalize('NFKC')
    .replace(/\s/g, '')
    .toUpperCase()
    .replace(/[АВЕКМНОРСТХУ]/g, (c) => LATIN_TWIN[c] ?? c);
}

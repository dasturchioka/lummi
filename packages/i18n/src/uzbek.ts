/** Every character a customer types as an apostrophe in Uzbek Latin: one source for the normaliser and search. */
export const APOSTROPHE_CLASS = "['‘’ʻʼ`´′ʹ]";
const AFTER_LETTER = new RegExp(`(\\p{L})${APOSTROPHE_CLASS}`, 'gu');

/**
 * Normalise Uzbek Latin apostrophes. Run it on every input path (search, forms, bot text).
 * After o/g (oʻ, gʻ) -> U+02BB; after any other letter (tutuq belgisi) -> U+2019.
 */
export function normalizeUzbek(input: string): string {
  return input.replace(AFTER_LETTER, (_m, letter: string) =>
    /[oOgG]/.test(letter) ? `${letter}\u02BB` : `${letter}\u2019`,
  );
}

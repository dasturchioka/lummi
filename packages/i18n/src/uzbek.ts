const APOSTROPHES = "['‘’ʻʼ`´′]";
const AFTER_O_G = new RegExp(`([oOgG])${APOSTROPHES}`, 'g');
const AFTER_OTHER = new RegExp(`(\\p{L})${APOSTROPHES}`, 'gu');

/**
 * Normalise Uzbek Latin apostrophes. Run it on every input path (search, forms, bot text).
 * After o/g (oʻ, gʻ) -> U+02BB; after any other letter (tutuq belgisi) -> U+2019.
 */
export function normalizeUzbek(input: string): string {
  return input.replace(AFTER_O_G, '$1ʻ').replace(AFTER_OTHER, (_m, letter: string) => `${letter}’`);
}

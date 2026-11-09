/** Every apostrophe-like character a keyboard or a copy-paste can produce (a regex character class). */
export const APOSTROPHE_CLASS = "['‘’ʻʼ`´′]";
const APOSTROPHES = APOSTROPHE_CLASS;
const AFTER_LETTER = new RegExp(`(\\p{L})${APOSTROPHES}`, 'gu');

/**
 * Normalise Uzbek Latin apostrophes. Run it on every input path (search, forms, bot text).
 * After o/g (oʻ, gʻ) -> U+02BB; after any other letter (tutuq belgisi) -> U+2019.
 */
export function normalizeUzbek(input: string): string {
  return input.replace(AFTER_LETTER, (_m, letter: string) =>
    /[oOgG]/.test(letter) ? `${letter}\u02BB` : `${letter}\u2019`,
  );
}

/** Drops every apostrophe variant, for comparing «Devil's» with «Devil’s» (search on both sides). */
export function stripApostrophes(input: string): string {
  return input.replace(new RegExp(APOSTROPHE_CLASS, 'gu'), '');
}

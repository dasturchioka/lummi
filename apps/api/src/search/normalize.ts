import { APOSTROPHE_CLASS, normalizeUzbek } from '@lummi/i18n';

/**
 * The Latin skeleton of search (ADR 0019): the one alphabet both the catalog documents and the
 * customer's query are reduced to, so «мегамаре», "Megamare" and "megamar" meet. It is lossy on
 * purpose and never shown to anyone; only equal skeletons and shared trigrams matter.
 *
 * Steps: lower case; the shared Uzbek apostrophe normaliser, then every apostrophe is dropped
 * (`oʻ`, `gʻ` and the tutuq belgisi all vanish: oʻ -> o, gʻ -> g); Cyrillic is transliterated;
 * accents are stripped (Météore -> meteore); digraphs are unified into one letter each
 * (sh -> x, ch -> c, zh -> j, ph -> f, th -> t, kh -> h, ng -> n); q, c, x, w, y fold into
 * k / s, ks, v, i; doubled letters collapse (Baccarat = Bakarat). Everything else becomes a
 * single space, so the skeleton is only a-z, 0-9 and single spaces.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'iu',
  я: 'ia',
  // Uzbek Cyrillic extras.
  ў: 'o',
  қ: 'k',
  ғ: 'g',
  ҳ: 'h',
};

const APOSTROPHES = new RegExp(APOSTROPHE_CLASS, 'g');

function transliterate(s: string): string {
  let out = '';
  for (const ch of s) out += CYRILLIC[ch] ?? ch;
  return out;
}

export function skeleton(input: string): string {
  let s = normalizeUzbek(input.normalize('NFC')).toLowerCase().replace(APOSTROPHES, '');
  s = transliterate(s)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    // Digraphs first, while c, x and y still mean what they mean in the source alphabet.
    .replace(/x/g, 'ks')
    .replace(/sch|sh/g, 'X')
    .replace(/ch/g, 'C')
    .replace(/dzh|zh|dz/g, 'j')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/kh|gh/g, (m) => (m === 'kh' ? 'h' : 'g'))
    .replace(/ng/g, 'n')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/X/g, 'x')
    .replace(/C/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .trim();
  return s;
}

/** Skeleton of several texts joined into one document (notes, aliases). */
export function skeletonOf(parts: readonly string[]): string {
  return skeleton(parts.join(' '));
}

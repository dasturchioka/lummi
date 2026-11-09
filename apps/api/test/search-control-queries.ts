/**
 * The 30 provisional control queries (TZ §3.2, ADR 0019), written against the real 67-fragrance
 * seed. Swap this list for the customer's when it arrives; the gate in `search-control.int.test.ts`
 * does not change.
 *
 * - `name`: the expected fragrance (any of `slugs`) is among the top 3.
 * - `note`: the query is a note in either language; every one of the top 3 must carry a note in
 *   `notes` (Russian dictionary names, at any level), because "vanilla" has dozens of answers.
 * - `brand`: the top 3 must all be by the brand.
 */
export type ControlQuery =
  | { q: string; why: string; kind: 'name'; slugs: string[] }
  | { q: string; why: string; kind: 'note'; notes: string[] }
  | { q: string; why: string; kind: 'brand'; brand: string };

export const CONTROL_QUERIES: ControlQuery[] = [
  // Names, as written.
  { q: 'Aventus', why: 'exact', kind: 'name', slugs: ['aventus'] },
  { q: 'Black Opium', why: 'exact', kind: 'name', slugs: ['black-opium'] },
  {
    q: 'Baccarat Rouge',
    why: 'prefix of a long name',
    kind: 'name',
    slugs: ['baccarat-rouge-540'],
  },
  { q: 'Tobacco Vanille', why: 'exact', kind: 'name', slugs: ['tobacco-vanille'] },
  { q: 'symphony', why: 'lower case', kind: 'name', slugs: ['symphony'] },
  // Typos.
  { q: 'aventuss', why: 'doubled letter', kind: 'name', slugs: ['aventus'] },
  { q: 'symfony', why: 'ph as f, missing letter', kind: 'name', slugs: ['symphony'] },
  {
    q: 'baccarat roge',
    why: 'missing letter in the second word',
    kind: 'name',
    slugs: ['baccarat-rouge-540'],
  },
  { q: 'sauvge', why: 'dropped vowel', kind: 'name', slugs: ['sauvage-edt'] },
  { q: 'ganimede', why: 'y as i', kind: 'name', slugs: ['ganymede'] },
  { q: 'blak opium', why: 'two slips', kind: 'name', slugs: ['black-opium'] },
  {
    q: 'stonger with you',
    why: 'dropped letter, three words',
    kind: 'name',
    slugs: ['stronger-with-you'],
  },
  // Cyrillic spellings of Latin names.
  { q: 'авентус', why: 'Cyrillic', kind: 'name', slugs: ['aventus', 'absolu-aventus'] },
  { q: 'симфония', why: 'Cyrillic, y and ph', kind: 'name', slugs: ['symphony'] },
  {
    q: 'баккара руж',
    why: 'Cyrillic, French spelling',
    kind: 'name',
    slugs: ['baccarat-rouge-540'],
  },
  { q: 'блэк опиум', why: 'Cyrillic, two words', kind: 'name', slugs: ['black-opium'] },
  { q: 'ганимед', why: 'Cyrillic, y and a dropped e', kind: 'name', slugs: ['ganymede'] },
  { q: 'либре', why: 'Cyrillic', kind: 'name', slugs: ['libre'] },
  { q: 'тайгар', why: 'Cyrillic', kind: 'name', slugs: ['tygar', 'tygar-extrait'] },
  { q: 'соваж', why: 'Cyrillic, French spelling', kind: 'name', slugs: ['sauvage-edt'] },
  // Notes in Russian and Uzbek (materials/catalog/notalar_lugati.txt).
  { q: 'ваниль', why: 'RU note, dozens of answers', kind: 'note', notes: ['ваниль'] },
  { q: 'уд', why: 'RU note, two letters', kind: 'note', notes: ['уд'] },
  { q: 'шафран', why: 'RU note', kind: 'note', notes: ['шафран'] },
  { q: 'тубероза', why: 'RU note, rare', kind: 'note', notes: ['тубероза'] },
  { q: 'zanjabil', why: 'UZ note (ginger)', kind: 'note', notes: ['имбирь'] },
  { q: 'tamaki', why: 'UZ note (tobacco)', kind: 'note', notes: ['табак', 'табачный лист'] },
  { q: 'yasmin', why: 'UZ note (jasmine)', kind: 'note', notes: ['жасмин'] },
  { q: 'olcha', why: 'UZ note (cherry)', kind: 'note', notes: ['вишня', 'вишнёвый ликёр'] },
  // Brands, in either alphabet.
  { q: 'Kilian', why: 'brand', kind: 'brand', brand: 'Kilian' },
  { q: 'том форд', why: 'brand in Cyrillic', kind: 'brand', brand: 'Tom Ford' },
];

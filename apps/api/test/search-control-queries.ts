/**
 * The 30 provisional control queries (TZ §3.2, ADR 0019), written against the real 67-fragrance
 * seed and meant to be hard: Cyrillic typed for Latin names and brands, both Uzbek apostrophes,
 * digraphs, two-letter typos. Swap this list for the customer's when it arrives; the gate in
 * `search-control.int.test.ts` does not change, and the queries must not be softened to pass.
 *
 * - `name`: one of `slugs` is within the top `top` (3 unless stated).
 * - `note`: a note with many answers; every one of the top 3 must carry one of `notes` (Russian
 *   dictionary names, any level).
 *
 * The ticket's own example «мегамаре» / «megamar» names a fragrance that is not in the 67 (the
 * seed has no Megamare), so its pattern is covered by «мэтеор» and «montabako»: a Cyrillic and a
 * clipped Latin spelling of a real name.
 */
export type ControlQuery =
  | { q: string; why: string; kind: 'name'; slugs: string[]; top?: number }
  | { q: string; why: string; kind: 'note'; notes: string[] };

export const CONTROL_QUERIES: ControlQuery[] = [
  // Cyrillic typed for Latin names and brands.
  { q: 'мэтеор', why: 'Cyrillic, ticket pattern «мегамаре»', kind: 'name', slugs: ['meteore'] },
  {
    q: 'montabako',
    why: 'clipped Latin, ticket pattern «megamar»',
    kind: 'name',
    slugs: ['montabaco-intensivo'],
  },
  { q: 'крид авентус', why: 'Cyrillic brand + name', kind: 'name', slugs: ['aventus'] },
  { q: 'том форд оуд вуд', why: 'Cyrillic brand + name', kind: 'name', slugs: ['oud-wood'] },
  {
    q: 'ив сен лоран либре',
    why: 'Cyrillic three-word brand + name',
    kind: 'name',
    slugs: ['libre'],
  },
  {
    q: 'гуччи флора гарденя',
    why: 'Cyrillic brand + name, dropped letter',
    kind: 'name',
    slugs: ['flora-gorgeous-gardenia'],
  },
  { q: 'ксерджофф эрба пура', why: 'Cyrillic, x as ks', kind: 'name', slugs: ['erba-pura'] },
  { q: 'киллиан смокинг хот', why: 'Cyrillic, doubled l', kind: 'name', slugs: ['smoking-hot'] },
  { q: 'вра вра врум', why: 'Cyrillic, repeated word', kind: 'name', slugs: ['vra-vra-vroom'] },
  { q: 'молекула 02', why: 'Cyrillic + digits', kind: 'name', slugs: ['molecule-02'] },
  // Apostrophes in names.
  { q: 'angels` share', why: 'backtick apostrophe', kind: 'name', slugs: ['angels-share'] },
  {
    q: 'девилс интригa',
    why: 'Cyrillic, no apostrophe, Latin a at the end',
    kind: 'name',
    slugs: ['devils-intrigue'],
  },
  // Two-letter typos.
  { q: 'stelar tims', why: 'two slips', kind: 'name', slugs: ['stellar-times'] },
  { q: 'angls shre', why: 'two dropped vowels', kind: 'name', slugs: ['angels-share'] },
  { q: 'ganimed', why: 'y as i, missing e', kind: 'name', slugs: ['ganymede'] },
  { q: 'bal dafrik', why: 'dropped letters, ending', kind: 'name', slugs: ['bal-dafrique'] },
  { q: 'oligrach', why: 'swapped letters', kind: 'name', slugs: ['oligarch'] },
  // UZ notes: apostrophes in all four forms, sh/ch digraphs.
  {
    q: 'koʻk choy',
    why: 'UZ note, ʻ, ch digraph (green tea)',
    kind: 'name',
    slugs: ['silver-mountain-water'],
  },
  {
    q: "qo'ng'ir shakar",
    why: "UZ note, ' twice, sh digraph (brown sugar)",
    kind: 'name',
    slugs: ['flora-gorgeous-gardenia'],
  },
  { q: 'sabzi urug’i', why: 'UZ note, ’ (carrot seeds)', kind: 'name', slugs: ['pacific-chill'] },
  { q: 'jo`ka guli', why: 'UZ note, backtick (linden blossom)', kind: 'name', slugs: ['tilia'] },
  {
    q: "kakliko'tt",
    why: "UZ note, ' and a typo (thyme)",
    kind: 'name',
    slugs: ['elysium-pour-homme-parfum', 'oligarch'],
  },
  { q: 'limon oʻti', why: 'UZ note, ʻ (lemongrass)', kind: 'name', slugs: ['rain-tea'] },
  {
    q: 'tuberoza',
    why: 'UZ note, two answers',
    kind: 'name',
    slugs: ['good-girl-gone-bad', 'my-way'],
  },
  // RU notes: one specific fragrance expected.
  {
    q: 'уд',
    why: 'RU note, two letters: oud',
    kind: 'name',
    slugs: ['oud-wood', 'oud-maracuja'],
    top: 5,
  },
  {
    q: 'ваниль',
    why: 'RU note, dozens carry it; the vanilla one first',
    kind: 'name',
    slugs: ['tobacco-vanille'],
  },
  { q: 'шафран', why: 'RU note; the saffron one first', kind: 'name', slugs: ['safran-secret'] },
  {
    q: 'bergamot',
    why: 'ticket example, note with many answers',
    kind: 'note',
    notes: ['бергамот'],
  },
  { q: 'сандал', why: 'RU note, many answers', kind: 'note', notes: ['сандал'] },
  { q: 'ладан', why: 'RU note, five answers', kind: 'note', notes: ['ладан'] },
];

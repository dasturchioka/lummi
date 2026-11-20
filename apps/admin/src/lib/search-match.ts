/** Lowercase, drop diacritics and the apostrophe family (ʻ ' ’ ` ʼ), collapse spaces. */
export function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ'’‘`´]/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every whitespace-separated word of the query occurs in the text (order-free). */
export function matchesSearch(text: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const t = normalizeSearch(text);
  return q.split(' ').every((w) => t.includes(w));
}

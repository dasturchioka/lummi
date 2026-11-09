/** Lower-case, «ё» as «е», single spaces: both the stored text and the query go through this. */
export function fold(s: string): string {
  return s.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

export function pointSearchText(p: {
  name: string;
  city: string;
  address: string;
  landmark?: string | null;
}): string {
  return fold([p.name, p.city, p.address, p.landmark ?? ''].join(' '));
}

/** A literal substring pattern for LIKE (escape char `\`). */
export function likeContains(s: string): string {
  return `%${fold(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

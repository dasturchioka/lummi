/**
 * Parser for the public bts.uz offices page (`/ru/nashi-ofisi?id=<region>`): one `<h1>` per
 * city or district, then a table with a row per office (`data-label` on every cell). Pure and
 * synchronous; the fetching lives in `cli/bts-fetch.ts`. Text stays as published (Russian).
 */
export interface ParsedPoint {
  code: string;
  name: string;
  city: string;
  address: string;
  landmark: string | null;
  hours: string | null;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&laquo;': '«',
  '&raquo;': '»',
};

function text(fragment: string): string {
  return fragment
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** «г.Самарканд», «город Джизак», «г. Газалкент» -> the bare name; districts keep «р-н». */
export function normalizeCity(heading: string): string {
  return text(heading)
    .replace(/^(г\.|город)\s*/i, '')
    .trim();
}

/** «Пн-Сб: 09:00-18:00 ; Вс: Выходные дни ; Время обеда: 13:00-14:00» -> a single readable line. */
export function normalizeHours(raw: string): string | null {
  const parts = text(raw)
    .split(/\s*;\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => {
      const lunch = /^Время обеда:\s*(.+)$/i.exec(p);
      if (lunch) return /\d/.test(lunch[1] ?? '') ? [`обед ${lunch[1]}`] : [];
      return [p.replace(/Выходные дни/gi, 'выходной')];
    });
  return parts.length ? parts.join('; ') : null;
}

/** Offices the site lists under an empty heading: the city a human can read off the office name. */
const CITY_BY_CODE: Record<string, string> = { '5025': 'Наманган' };

export function parseOffices(html: string): ParsedPoint[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const out: ParsedPoint[] = [];
  let city = '';
  const token = /<h1[^>]*>([\s\S]*?)<\/h1>|<tr style="font-size: 16px">([\s\S]*?)<\/tr>/g;
  for (const m of body.matchAll(token)) {
    if (m[1] !== undefined) {
      city = normalizeCity(m[1]);
      continue;
    }
    const cells: Record<string, string> = {};
    for (const c of (m[2] ?? '').matchAll(/<td data-label="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)) {
      cells[c[1] ?? ''] = c[2] ?? '';
    }
    const code = text(cells['No'] ?? '');
    const address = text(cells['Адрес'] ?? '').replace(/\s*Посмотреть на карте.*$/i, '');
    if (!code || !address) continue;
    out.push({
      code,
      name: text(cells['Филиал'] ?? ''),
      city: city || CITY_BY_CODE[code] || address,
      address,
      landmark:
        text(cells['Ориентир'] ?? '')
          .replace(/\s*Видео ориентир.*$/i, '')
          .trim() || null,
      hours: normalizeHours(cells['Рабочие дни'] ?? ''),
    });
  }
  return out;
}

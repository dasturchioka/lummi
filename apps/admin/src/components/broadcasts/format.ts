import { plural, type Language, type PluralForms } from '@lummi/i18n';
import { fill } from '@/lib/utils';

/**
 * «50 420», «1 557»: thousands grouped with a no-break space (U+00A0, as DESIGN.md groups so'm).
 * The settings' narrow space (U+202F) all but disappears in 12–13 px Manrope, so «1 557» read
 * as «1557» in the counters and the count line.
 */
export const num = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, '\u00a0');

const parts = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Tashkent',
});

/**
 * «10.11.2026, 13:15» in the shop's time zone (Asia/Tashkent, never the browser's). Built by hand
 * from fixed en-GB parts: Node's and the browser's `uz` locale data differ, which breaks hydration.
 */
export function formatWhen(iso: string, _language: Language): string {
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
}

/** «50 000 клиентов»: the plural form for `n`, its thousands grouped by `num`. */
export const countOf = (language: Language, n: number, forms: PluralForms) =>
  fill(plural(language, n, forms), { total: num(n) });

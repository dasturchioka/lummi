import type { Language } from '@lummi/i18n';

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

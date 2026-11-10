import { formatDayMonth, type Language } from '@lummi/i18n';

/**
 * The calendar day of a markdown's end, as the customer reads it in Tashkent:
 * `12 ноября` / `12-noyabrgacha` (the UZ form already carries "until" and must never break across
 * lines; the caller wraps it). The RU caller adds «до».
 */
export function saleEndDate(iso: string, language: Language): string {
  const day = formatDayMonth(iso, language);
  return language === 'uz' ? `${day}gacha` : day;
}

/**
 * A number never ends a line apart from the word it counts: «24 soatgacha», «до 24 часов». The
 * longevity text is catalog data (the seed and the admin), so the card glues it where it shows it.
 */
export const keepNumberWithWord = (text: string): string =>
  text.replace(/(\d) +(?=\p{L})/gu, '$1 ');

/** A file's size as the shopper reads it: `350 КБ`, `1,2 МБ` / `350 KB`, `1,2 MB`. */
export function formatFileSize(bytes: number, language: Language): string {
  const [kb, mb] = language === 'uz' ? ['KB', 'MB'] : ['КБ', 'МБ'];
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ${kb}`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} ${mb}`;
}

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

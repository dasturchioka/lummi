import type { Language } from '@lummi/i18n';

const MONTHS: Record<Language, readonly string[]> = {
  ru: [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ],
  uz: [
    'yanvar',
    'fevral',
    'mart',
    'aprel',
    'may',
    'iyun',
    'iyul',
    'avgust',
    'sentabr',
    'oktabr',
    'noyabr',
    'dekabr',
  ],
};

const TASHKENT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tashkent',
  day: 'numeric',
  month: 'numeric',
});

/**
 * The calendar day of a markdown's end, as the customer reads it in Tashkent:
 * `12 ноября` / `12-noyabrgacha` (the UZ form already carries "until" and must never break across
 * lines; the caller wraps it). The RU caller adds «до».
 */
export function saleEndDate(iso: string, language: Language): string {
  const parts = TASHKENT.formatToParts(new Date(iso));
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const name = MONTHS[language][month - 1] ?? '';
  return language === 'uz' ? `${day}-${name}gacha` : `${day} ${name}`;
}

/**
 * A number never ends a line apart from the word it counts: «24 soatgacha», «до 24 часов». The
 * longevity text is catalog data (the seed and the admin), so the card glues it where it shows it.
 */
export const keepNumberWithWord = (text: string): string =>
  text.replace(/(\d) +(?=\p{L})/gu, '$1 ');

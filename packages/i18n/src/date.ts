import type { Language } from './language';

/** Asia/Tashkent is UTC+05:00 all year (no DST since 1992); dates are read on its wall clock. */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Month names in the form a date takes after the day: «7 ноября» / «7-noyabr». */
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

function tashkent(instant: Date | string) {
  const d = new Date(new Date(instant).getTime() + TASHKENT_OFFSET_MS);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** The Tashkent calendar day: `7 ноября` / `7-noyabr`. */
export function formatDayMonth(instant: Date | string, language: Language): string {
  const { day, month } = tashkent(instant);
  const name = MONTHS[language][month] ?? '';
  return language === 'uz' ? `${day}-${name}` : `${day} ${name}`;
}

/**
 * A calendar day written `YYYY-MM-DD` (a date, not an instant: a birthday, a coupon's first day):
 * `14 марта` / `14-mart`, with the year `14 марта 1996` / `1996-yil 14-mart`.
 */
export function formatCalendarDate(iso: string, language: Language, withYear = false): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const name = MONTHS[language][month - 1] ?? '';
  if (language === 'uz') return withYear ? `${year}-yil ${day}-${name}` : `${day}-${name}`;
  return withYear ? `${day} ${name} ${year}` : `${day} ${name}`;
}

/** The Tashkent wall-clock time: `20:40`. */
export function formatTime(instant: Date | string): string {
  const { hour, minute } = tashkent(instant);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Day and time in Tashkent: `7 ноября, 20:40` / `7-noyabr, 20:40`. */
export function formatDateTime(instant: Date | string, language: Language): string {
  return `${formatDayMonth(instant, language)}, ${formatTime(instant)}`;
}

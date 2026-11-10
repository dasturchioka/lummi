import type { Language } from './language';
import { plural, type PluralForms } from './plural';

const UNITS: Record<Language, { hours: PluralForms; minutes: PluralForms }> = {
  ru: {
    hours: { one: '{n} час', few: '{n} часа', many: '{n} часов', other: '{n} часа' },
    minutes: { one: '{n} минута', few: '{n} минуты', many: '{n} минут', other: '{n} минуты' },
  },
  uz: {
    hours: { one: '{n} soat', few: '{n} soat', many: '{n} soat', other: '{n} soat' },
    minutes: { one: '{n} daqiqa', few: '{n} daqiqa', many: '{n} daqiqa', other: '{n} daqiqa' },
  },
};

/**
 * A time window as customers read it (the reserve, ADR 0012): whole hours («12 часов» /
 * «12 soat»), otherwise whole minutes, rounded down so it never promises more time than there is.
 */
export function formatDuration(seconds: number, language: Language): string {
  const hours = seconds % 3600 === 0;
  const n = hours ? seconds / 3600 : Math.floor(seconds / 60);
  return plural(language, n, UNITS[language][hours ? 'hours' : 'minutes']);
}

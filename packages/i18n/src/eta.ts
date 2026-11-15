import type { Language } from './language';
import { plural, type PluralForms } from './plural';

const RU: PluralForms = {
  one: 'до {n} часа',
  few: 'до {n} часов',
  many: 'до {n} часов',
  other: 'до {n} часов',
};
const UZ: PluralForms = {
  one: '{n} soatgacha',
  few: '{n} soatgacha',
  many: '{n} soatgacha',
  other: '{n} soatgacha',
};

/**
 * The customer's delivery term from the setting `delivery.etaHours`: «до 48 часов» / «48 soatgacha».
 * Copy puts it in an `{eta}` slot, so the number is never baked into a string.
 */
export const deliveryEta = (language: Language, hours: number): string =>
  plural(language, hours, language === 'uz' ? UZ : RU);

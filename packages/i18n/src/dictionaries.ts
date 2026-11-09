import type { Language } from './language';

/** ru is the reference; uz must have exactly the same keys, or typecheck fails. */
export const ru = {
  common: {
    currency: 'сум',
  },
  bot: {
    greeting:
      'Добро пожаловать в LUMMI.\nExtrait de Parfum по мотивам известных ароматов. Откройте магазин и выберите свой.',
    openShop: 'Открыть магазин',
    alertPrefix: 'Системное сообщение',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    sessionExpired: 'Сессия истекла. Откройте приложение заново.',
  },
} as const;

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
export type Messages = DeepString<typeof ru>;

export const uz: Messages = {
  common: {
    currency: 'soʻm',
  },
  bot: {
    greeting:
      'LUMMI ga xush kelibsiz.\nMashhur atirlar asosidagi Extrait de Parfum. Doʻkonni oching va oʻzingizni tanlang.',
    openShop: 'Doʻkonni ochish',
    alertPrefix: 'Tizim xabari',
  },
  errors: {
    generic: 'Nimadir xato ketdi. Qaytadan urinib koʻring.',
    sessionExpired: 'Seans tugadi. Ilovani qaytadan oching.',
  },
};

export const dictionaries: Record<Language, Messages> = { ru, uz };

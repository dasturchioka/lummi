import type { Language } from './language';

/** ru is the reference; uz must have exactly the same keys, or typecheck fails. */
export const ru = {
  common: {
    currency: 'сум',
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
  errors: {
    generic: 'Nimadir xato ketdi. Qaytadan urinib koʻring.',
    sessionExpired: 'Seans tugadi. Ilovani qaytadan oching.',
  },
};

export const dictionaries: Record<Language, Messages> = { ru, uz };

import { defineMessages } from './define';

/** Strings every surface (Mini App, bot, admin) may use. Keys must match in both languages or typecheck fails. */
export const sharedMessages = defineMessages(
  {
    common: {
      currency: 'сум',
      retry: 'Повторить',
      loading: 'Загрузка',
      close: 'Закрыть',
    },
    /** A Promo gift as every surface names it (ADR 0039): `promoGiftLabel`. */
    promoGift: { volume: '{name} {ml} мл', discovery: 'Discovery set' },
    errors: {
      generic: 'Что-то пошло не так. Попробуйте ещё раз.',
      sessionExpired: 'Сессия истекла. Откройте приложение заново.',
      loadFailedTitle: 'Не удалось загрузить',
      loadFailedText: 'Проверьте соединение и повторите.',
    },
  },
  {
    common: {
      currency: 'soʻm',
      retry: 'Qayta urinish',
      loading: 'Yuklanmoqda',
      close: 'Yopish',
    },
    promoGift: { volume: '{name} {ml} ml', discovery: 'Discovery set' },
    errors: {
      generic: 'Nimadir xato ketdi. Qaytadan urinib koʻring.',
      sessionExpired: 'Seans tugadi. Ilovani qaytadan oching.',
      loadFailedTitle: 'Yuklab boʻlmadi',
      loadFailedText: 'Internetni tekshiring va qayta urinib koʻring.',
    },
  },
);
export type SharedMessages = (typeof sharedMessages)['ru'];

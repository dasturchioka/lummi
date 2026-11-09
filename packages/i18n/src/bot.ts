import { defineMessages } from './define';

/** Bot messages. Import from `@lummi/i18n/bot`; the Mini App never bundles them. Keys must match in both languages or typecheck fails. */
export const botMessages = defineMessages(
  {
    bot: {
      greeting:
        'Добро пожаловать в LUMMI.\nExtrait de Parfum по мотивам известных ароматов. Откройте магазин и выберите свой.',
      openShop: 'Открыть магазин',
      alertPrefix: 'Системное сообщение',
    },
  },
  {
    bot: {
      greeting:
        'LUMMI ga xush kelibsiz.\nMashhur atirlar asosidagi Extrait de Parfum. Doʻkonni oching va oʻzingizni tanlang.',
      openShop: 'Doʻkonni ochish',
      alertPrefix: 'Tizim xabari',
    },
  },
);
export type BotMessages = (typeof botMessages)['ru'];

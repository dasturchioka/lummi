import { defineMessages } from './define';

/** Bot messages. Import from `@lummi/i18n/bot`; the Mini App never bundles them. Keys must match in both languages or typecheck fails. */
export const botMessages = defineMessages(
  {
    bot: {
      greeting:
        'Добро пожаловать в LUMMI.\nExtrait de Parfum по мотивам известных ароматов. Откройте магазин и выберите свой.',
      openShop: 'Открыть магазин',
      /** The link button under a broadcast. */
      broadcastOpen: 'Открыть',
      alertPrefix: 'Системное сообщение',
      /** The "order created" message (spec Changes 2026-11-07, customer messages): 1-2 emoji. */
      orderCreated:
        'Заказ № {number} оформлен ✨\nСумма к оплате: {amount}\nАроматы забронированы до {until}. Статус заказа всегда виден в разделе «Заказы».',
      openOrder: 'Открыть заказ',
    },
  },
  {
    bot: {
      greeting:
        'LUMMI ga xush kelibsiz.\nMashhur atirlar asosidagi Extrait de Parfum. Doʻkonni oching va oʻzingizni tanlang.',
      openShop: 'Doʻkonni ochish',
      broadcastOpen: 'Ochish',
      alertPrefix: 'Tizim xabari',
      orderCreated:
        '№ {number} buyurtma rasmiylashtirildi ✨\nToʻlov summasi: {amount}\nAtirlar {until} gacha band qilindi. Buyurtma holati doim «Buyurtmalar» boʻlimida koʻrinadi.',
      openOrder: 'Buyurtmani ochish',
    },
  },
);
export type BotMessages = (typeof botMessages)['ru'];

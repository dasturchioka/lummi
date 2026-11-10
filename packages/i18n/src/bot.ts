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
      writeManager: 'Написать менеджеру',
      /** Before the reserve ends while the order still waits for a receipt (setting `orders.reserveReminderSeconds`). */
      reserveReminder:
        'Бронь заказа № {number} действует до {until} ⏳\nЗагрузите чек об оплате {amount}, и бронь сохранится до проверки.',
      /** One message per status change (spec Changes 2026-11-07, customer messages); none for «Принят» or a return. */
      receiptReceived:
        'Чек к заказу № {number} получен 🧾\nПроверяем оплату и напишем, как только она подтвердится.',
      paymentConfirmed:
        'Оплата заказа № {number} подтверждена ✅\nСкоро начнём собирать ваш заказ.',
      receiptRejected:
        'Чек к заказу № {number} не принят.\nПричина: {reason}\nПроверьте сумму и карту и загрузите чек ещё раз.',
      paymentNotFound:
        'Мы не нашли перевод по заказу № {number}.\nПроверьте сумму ({amount}) и карту и загрузите чек ещё раз.',
      assembling: 'Собираем заказ № {number} 📦\nБережно упакуем ароматы и передадим в BTS.',
      handedToBts:
        'Заказ № {number} передан в BTS 🚚\nТрек-номер: {tracking}\nДоставка до пункта BTS — до 48 часов.',
      delivered: 'Заказ № {number} доставлен ✨\nСпасибо, что выбрали LUMMI.',
      /** The reason is the shopper-facing sentence of `orders.cancelReason`. */
      orderCancelled: 'Заказ № {number} отменён.\n{reason}.',
      /** Added to «Отменён» when the order had been paid: the money goes back as a Refund (ADR 0006). */
      refundNote: 'Менеджер свяжется с вами, чтобы вернуть деньги.',
      /** A receipt sent to the bot (#31); the receipt-received message itself is `receiptReceived`. */
      receiptNoOrders:
        'Сейчас нет заказов, ожидающих оплаты. Оформите заказ в магазине, а затем отправьте чек сюда.',
      openOrders: 'Открыть заказы',
      receiptUnknownUser:
        'Сначала откройте магазин: после первого входа сюда можно будет отправлять чеки.',
      receiptWhichOrder: 'К какому заказу относится этот чек?',
      /** The button per order: «№ 1012 · 243 000 сум». */
      receiptOrderChoice: '№ {number} · {amount}',
      receiptTooLarge:
        'Файл слишком большой: можно до {max} МБ. Отправьте чек поменьше, например скриншот.',
      receiptUnsupported:
        'Не получилось принять этот файл. Отправьте чек как фото, скриншот (JPG, PNG, WebP) или PDF.',
      receiptUnreadable: 'Файл не открывается. Отправьте чек ещё раз, лучше скриншотом.',
      receiptTryAgain: 'Сейчас не получилось принять чек. Отправьте его ещё раз через минуту.',
      /** The order already has a receipt under check (or is no longer waiting for payment). */
      receiptUnderCheck:
        'К заказу № {number} чек уже отправлен и проверяется. Мы напишем, как только оплата подтвердится.',
      orderNotAwaiting: 'Заказ № {number} уже не ожидает оплаты, чек не нужен.',
      receiptExpired: 'Этот выбор устарел. Отправьте чек ещё раз.',
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
      writeManager: 'Menejerga yozish',
      reserveReminder:
        '№ {number} buyurtma bandligi {until} gacha amal qiladi ⏳\n{amount} toʻlov chekini yuklang, shunda bandlik tekshiruvgacha saqlanadi.',
      receiptReceived:
        '№ {number} buyurtma cheki qabul qilindi 🧾\nToʻlovni tekshiryapmiz, tasdiqlanishi bilan xabar beramiz.',
      paymentConfirmed:
        '№ {number} buyurtma toʻlovi tasdiqlandi ✅\nTez orada buyurtmangizni yigʻishni boshlaymiz.',
      receiptRejected:
        '№ {number} buyurtma cheki qabul qilinmadi.\nSabab: {reason}\nSumma va kartani tekshirib, chekni qayta yuklang.',
      paymentNotFound:
        '№ {number} buyurtma boʻyicha oʻtkazmani topa olmadik.\nSumma ({amount}) va kartani tekshirib, chekni qayta yuklang.',
      assembling:
        '№ {number} buyurtmani yigʻyapmiz 📦\nAtirlarni ehtiyotkorlik bilan qadoqlab, BTSga topshiramiz.',
      handedToBts:
        '№ {number} buyurtma BTSga topshirildi 🚚\nTrek-raqam: {tracking}\nBTS punktigacha yetkazish 48 soatgacha.',
      delivered: '№ {number} buyurtma yetkazildi ✨\nLUMMIni tanlaganingiz uchun rahmat.',
      orderCancelled: '№ {number} buyurtma bekor qilindi.\n{reason}.',
      refundNote: 'Pulni qaytarish uchun menejer siz bilan bogʻlanadi.',
      receiptNoOrders:
        'Hozir toʻlov kutayotgan buyurtma yoʻq. Doʻkonda buyurtma bering, keyin chekni shu yerga yuboring.',
      openOrders: 'Buyurtmalarni ochish',
      receiptUnknownUser:
        'Avval doʻkonni oching: birinchi kirishdan keyin bu yerga chek yuborish mumkin boʻladi.',
      receiptWhichOrder: 'Bu chek qaysi buyurtmaga tegishli?',
      receiptOrderChoice: '№ {number} · {amount}',
      receiptTooLarge:
        'Fayl juda katta: {max} MB gacha boʻlishi mumkin. Kichikroq chek yuboring, masalan skrinshot.',
      receiptUnsupported:
        'Bu faylni qabul qilib boʻlmadi. Chekni rasm, skrinshot (JPG, PNG, WebP) yoki PDF koʻrinishida yuboring.',
      receiptUnreadable: 'Fayl ochilmayapti. Chekni qayta yuboring, yaxshisi skrinshot qilib.',
      receiptTryAgain: 'Hozir chekni qabul qilib boʻlmadi. Bir daqiqadan keyin qayta yuboring.',
      receiptUnderCheck:
        '№ {number} buyurtmaga chek allaqachon yuborilgan va tekshirilmoqda. Toʻlov tasdiqlanishi bilan xabar beramiz.',
      orderNotAwaiting: '№ {number} buyurtma endi toʻlov kutmayapti, chek kerak emas.',
      receiptExpired: 'Bu tanlov eskirgan. Chekni qayta yuboring.',
    },
  },
);
export type BotMessages = (typeof botMessages)['ru'];

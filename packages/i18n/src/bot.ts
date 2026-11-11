import { defineMessages } from './define';
import { fill } from './fill';
import type { Language } from './language';
import { ordersMessages } from './orders';

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
      /**
       * An unused upgrade right, some days before its last day (TZ §3.4: 7 and 1; #38). `{until}` is
       * the last day, `{names}` the covered fragrances.
       */
      upgradeRightReminder: {
        set: 'Напоминаем: скидка за набор −{percent}% действует до {until} включительно ⏳\nОна на один полный флакон любого аромата из набора: {names}.',
        single_10ml:
          'Напоминаем: скидка −{percent}% за флакон 10 мл действует до {until} включительно ⏳\nОна на один полный флакон аромата {names}.',
      },
      /** A fragrance in a bot message, always with its original (CLAUDE.md brand rule). */
      fragranceNamed: '{name} (по мотивам {brand})',
      /**
       * The line «Доставлен» adds when the order opened an upgrade right (#38): no emoji, the
       * message has one. `{until}` is its last day.
       */
      upgradeRightOpened: {
        set: 'Вам открыта скидка −{percent}% на полный флакон одного из ароматов набора — до {until} включительно. Она уже в «Мои скидки» в профиле.',
        single_10ml:
          'Вам открыта скидка −{percent}% на полный флакон аромата из вашего флакона 10 мл — до {until} включительно. Она уже в «Мои скидки» в профиле.',
      },
      /** One message per status change (spec Changes 2026-11-07, customer messages); none for «Принят» or a return. */
      receiptReceived:
        'Чек к заказу № {number} получен 🧾\nПроверяем оплату и напишем, как только она подтвердится.',
      paymentConfirmed:
        'Оплата заказа № {number} подтверждена ✅\nСкоро начнём собирать ваш заказ.',
      receiptRejected:
        'Чек к заказу № {number} не принят.\nПричина: {reason}\nПроверьте сумму и карту и загрузите чек ещё раз.',
      /** The manager's own words under a preset reason (#33). */
      rejectNote: 'Комментарий менеджера: {note}',
      /** The wait window ended with no fitting credit (ADR 0012); the order waits for payment again. */
      paymentNotFound:
        'Мы не нашли перевод по заказу № {number}.\nПроверьте сумму ({amount}) и карту и загрузите чек ещё раз до {until}.',
      /** The same, when the reserve has ended too: the cancel message follows. */
      paymentNotFoundReserveEnded:
        'Мы не нашли перевод по заказу № {number}, а время брони истекло.\nЕсли вы уже перевели {amount}, напишите менеджеру — мы проверим.',
      /** The receipt repeats one sent for another order (spec Changes 2026-11-07, payment details). */
      paymentNotFoundDuplicate:
        'Этот чек уже отправляли к другому заказу, поэтому принять его к заказу № {number} мы не можем.\nЗагрузите чек перевода {amount} именно за этот заказ до {until}.',
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
      /** The review request (#41, setting `reviews.requestDelayHours` after «Доставлен»): 1-5 buttons follow. */
      reviewRequest: 'Как вам заказ № {number}? Оцените его от 1 до 5.',
      reviewAskComment:
        'Спасибо за оценку {rating}! Если хотите, напишите пару слов о ваших впечатлениях. Или нажмите «Пропустить».',
      reviewSkip: 'Пропустить',
      reviewDone: 'Готово',
      reviewAskPhotos: 'Можно добавить до {max} фото. Отправьте их сюда или нажмите «Готово».',
      reviewPhotoTaken: 'Фото {n} из {max} получено.',
      reviewPhotoUnsupported:
        'Это фото принять не получилось. Отправьте снимок в формате JPG, PNG или WebP.',
      reviewPhotoTooLarge: 'Фото слишком большое: можно до {max} МБ.',
      reviewPhotoTryAgain: 'Сейчас не получилось принять фото. Отправьте его ещё раз через минуту.',
      reviewCommentTooLong:
        'Комментарий слишком длинный: можно до {max} символов. Сократите его и отправьте ещё раз.',
      reviewThanks: 'Спасибо за отзыв! Он помогает нам делать LUMMI лучше.',
      reviewThanksLow:
        'Спасибо, что рассказали. Нам жаль, что что-то пошло не так: менеджер свяжется с вами.',
      reviewAlready: 'Вы уже оценили этот заказ. Спасибо!',
      /** The birthday coupon, 10:00 Tashkent a few days before (TZ §3.8, #30): `{max}` is money, `{until}` the last day. */
      birthdayCoupon:
        'С наступающим днём рождения! 🎁\nДарим вам купон −{percent}% на ароматы LUMMI, скидка до {max}. Он действует до {until} включительно и сам применится в корзине.',
      /**
       * The orders group (#37): the order's card in «Заказы», its buttons and the tracking-number
       * question. Staff read it, so it goes out in Russian, like the owner alerts.
       */
      group: {
        title: 'Заказ № {number}',
        reviewTitle: 'Отзыв {rating}/5 · заказ № {number}',
        reviewPhone: 'Телефон',
        reviewName: 'Покупатель',
        reviewComment: 'Комментарий',
        reviewNoComment: 'Без комментария',
        reviewItems: 'В заказе',
        discount: 'Скидка ({source})',
        delivery: 'Доставка',
        free: 'бесплатно',
        total: 'Итого',
        point: 'Пункт BTS',
        landmark: 'Ориентир',
        typed: 'Адрес указан вручную',
        typedNote: 'Подберите пункт BTS и свяжитесь с покупателем.',
        recipient: 'Получатель',
        customer: 'Покупатель',
        comment: 'Комментарий',
        gift: 'Это подарок',
        greeting: 'Открытка: «{text}»',
        noGreeting: 'Без открытки',
        tracking: 'Трек-номер',
        refundDue: 'Заказ был оплачен: верните деньги покупателю.',
        history: 'История',
        placed: 'Заказ оформлен',
        moreLines: '… и ещё {n}: полный состав в админке',
        moreHistory: '… и ещё {n} раньше',
        cancelAsk: 'Отмена заказа: выберите причину.',
        cancelConfirm: 'Отменить заказ? Причина: {reason}.',
        step: {
          accept: '✅ Принят',
          start_assembly: '📦 Собирается',
          hand_to_bts: '🚚 Передан в BTS',
          deliver: '🏁 Доставлен',
        },
        cancel: 'Отменить',
        confirmCancel: 'Да, отменить: {reason}',
        back: '‹ Назад',
        changed: 'Уже изменено',
        noAccess: 'Нет доступа',
        /** A button the bot never drew: forged data, or a step that does not exist. */
        refused: 'Нельзя',
        askTracking:
          '{name}, введите трек-номер BTS для заказа № {number} ответом на это сообщение.',
        trackingPlaceholder: 'Трек-номер BTS',
        trackingAsked: 'Ответьте трек-номером на сообщение бота',
        trackingInvalid:
          'Трек-номер — от {min} до {max} символов. Ответьте на это сообщение ещё раз.',
        trackingNotYours:
          'Трек-номер для заказа № {number} ждём от {name}. Чтобы ввести его самим, нажмите «Передан в BTS» на карточке.',
        trackingStale: 'Заказ № {number} уже изменён, трек-номер не сохранён.',
        trackingSuperseded:
          'Этот вопрос по заказу № {number} уже не действует: ответьте на последний вопрос бота.',
        receiptCaption: 'Чек к заказу № {number}',
      },
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
      upgradeRightReminder: {
        set: 'Eslatma: toʻplam uchun −{percent}% chegirma {until} kuni oxirigacha amal qiladi ⏳\nU toʻplamdagi istalgan iforning bitta toʻliq flakoniga: {names}.',
        single_10ml:
          'Eslatma: 10 ml flakon uchun −{percent}% chegirma {until} kuni oxirigacha amal qiladi ⏳\nU {names} iforining bitta toʻliq flakoniga.',
      },
      fragranceNamed: '{name} ({brand} asosida)',
      upgradeRightOpened: {
        set: 'Sizga toʻplamdagi iforlardan birining toʻliq flakoniga −{percent}% chegirma ochildi — {until} kuni oxirigacha. U profildagi «Mening chegirmalarim» boʻlimida.',
        single_10ml:
          'Sizga 10 ml flakoningizdagi iforning toʻliq flakoniga −{percent}% chegirma ochildi — {until} kuni oxirigacha. U profildagi «Mening chegirmalarim» boʻlimida.',
      },
      receiptReceived:
        '№ {number} buyurtma cheki qabul qilindi 🧾\nToʻlovni tekshiryapmiz, tasdiqlanishi bilan xabar beramiz.',
      paymentConfirmed:
        '№ {number} buyurtma toʻlovi tasdiqlandi ✅\nTez orada buyurtmangizni yigʻishni boshlaymiz.',
      receiptRejected:
        '№ {number} buyurtma cheki qabul qilinmadi.\nSabab: {reason}\nSumma va kartani tekshirib, chekni qayta yuklang.',
      rejectNote: 'Menejer izohi: {note}',
      paymentNotFound:
        '№ {number} buyurtma boʻyicha oʻtkazmani topa olmadik.\nSumma ({amount}) va kartani tekshirib, chekni {until} gacha qayta yuklang.',
      paymentNotFoundReserveEnded:
        '№ {number} buyurtma boʻyicha oʻtkazmani topa olmadik, bandlik muddati esa tugadi.\nAgar {amount} oʻtkazgan boʻlsangiz, menejerga yozing — tekshirib beramiz.',
      paymentNotFoundDuplicate:
        'Bu chek boshqa buyurtmaga yuborilgan, shuning uchun uni № {number} buyurtmaga qabul qila olmaymiz.\nAynan shu buyurtma uchun {amount} oʻtkazma chekini {until} gacha yuklang.',
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
      reviewRequest: '№ {number} buyurtma sizga qanday? 1 dan 5 gacha baholang.',
      reviewAskComment:
        'Bahoyingiz uchun rahmat: {rating}! Xohlasangiz, taassurotlaringiz haqida bir-ikki soʻz yozing. Yoki «Oʻtkazib yuborish» tugmasini bosing.',
      reviewSkip: 'Oʻtkazib yuborish',
      reviewDone: 'Tayyor',
      reviewAskPhotos:
        '{max} tagacha rasm qoʻshish mumkin. Ularni shu yerga yuboring yoki «Tayyor» tugmasini bosing.',
      reviewPhotoTaken: 'Rasm {n} / {max} qabul qilindi.',
      reviewPhotoUnsupported:
        'Bu rasmni qabul qilib boʻlmadi. JPG, PNG yoki WebP formatidagi suratni yuboring.',
      reviewPhotoTooLarge: 'Rasm juda katta: {max} MB gacha boʻlishi mumkin.',
      reviewPhotoTryAgain: 'Hozir rasmni qabul qilib boʻlmadi. Bir daqiqadan keyin qayta yuboring.',
      reviewCommentTooLong:
        'Izoh juda uzun: {max} belgigacha boʻlishi mumkin. Qisqartirib, qayta yuboring.',
      reviewThanks: 'Sharhingiz uchun rahmat! U LUMMIni yaxshilashga yordam beradi.',
      reviewThanksLow:
        'Aytganingiz uchun rahmat. Nimadir yaxshi chiqmagani uchun afsusdamiz: menejer siz bilan bogʻlanadi.',
      reviewAlready: 'Siz bu buyurtmani allaqachon baholagansiz. Rahmat!',
      birthdayCoupon:
        'Yaqinlashayotgan tugʻilgan kuningiz bilan tabriklaymiz! 🎁\nSizga LUMMI iforlariga −{percent}% kupon sovgʻa qilamiz, chegirma {max}gacha. Kupon {until} kuni oxirigacha amal qiladi va savatda oʻzi qoʻllanadi.',
      group: {
        title: '№ {number} buyurtma',
        reviewTitle: 'Sharh {rating}/5 · № {number} buyurtma',
        reviewPhone: 'Telefon',
        reviewName: 'Xaridor',
        reviewComment: 'Izoh',
        reviewNoComment: 'Izohsiz',
        reviewItems: 'Buyurtmada',
        discount: 'Chegirma ({source})',
        delivery: 'Yetkazish',
        free: 'bepul',
        total: 'Jami',
        point: 'BTS punkti',
        landmark: 'Moʻljal',
        typed: 'Manzil qoʻlda kiritilgan',
        typedNote: 'BTS punktini tanlang va xaridor bilan bogʻlaning.',
        recipient: 'Qabul qiluvchi',
        customer: 'Xaridor',
        comment: 'Izoh',
        gift: 'Bu sovgʻa',
        greeting: 'Otkritka: «{text}»',
        noGreeting: 'Otkritkasiz',
        tracking: 'Trek-raqam',
        refundDue: 'Buyurtma toʻlangan edi: pulni xaridorga qaytaring.',
        history: 'Tarix',
        placed: 'Buyurtma rasmiylashtirildi',
        moreLines: '… yana {n} ta: toʻliq tarkib admin panelda',
        moreHistory: '… oldinroq yana {n} ta',
        cancelAsk: 'Buyurtmani bekor qilish: sababni tanlang.',
        cancelConfirm: 'Buyurtma bekor qilinsinmi? Sabab: {reason}.',
        step: {
          accept: '✅ Qabul qilindi',
          start_assembly: '📦 Yigʻilmoqda',
          hand_to_bts: '🚚 BTSga topshirildi',
          deliver: '🏁 Yetkazildi',
        },
        cancel: 'Bekor qilish',
        confirmCancel: 'Ha, bekor qilish: {reason}',
        back: '‹ Orqaga',
        changed: 'Allaqachon oʻzgargan',
        noAccess: 'Ruxsat yoʻq',
        refused: 'Mumkin emas',
        askTracking:
          '{name}, № {number} buyurtmaning BTS trek-raqamini shu xabarga javob qilib yuboring.',
        trackingPlaceholder: 'BTS trek-raqami',
        trackingAsked: 'Bot xabariga trek-raqam bilan javob bering',
        trackingInvalid:
          'Trek-raqam {min} dan {max} tagacha belgidan iborat. Shu xabarga qayta javob bering.',
        trackingNotYours:
          '№ {number} buyurtmaning trek-raqamini {name} kiritadi. Oʻzingiz kiritish uchun kartochkadagi «BTSga topshirildi» tugmasini bosing.',
        trackingStale: '№ {number} buyurtma allaqachon oʻzgargan, trek-raqam saqlanmadi.',
        trackingSuperseded:
          '№ {number} buyurtma boʻyicha bu savol endi amal qilmaydi: botning oxirgi savoliga javob bering.',
        receiptCaption: '№ {number} buyurtma cheki',
      },
    },
  },
);
export type BotMessages = (typeof botMessages)['ru'];

/** A preset reason a manager rejects a receipt with (contracts `RECEIPT_REJECT_REASONS`). */
export type ReceiptRejectReasonKey =
  keyof (typeof ordersMessages)['ru']['orders']['receiptRejectReason'];

/**
 * The shopper's «Чек не принят» message (#33): the preset as a sentence in their language, the
 * manager's note on its own line under it, or, for `other`, the note itself as the reason. The
 * bot sends it and the admin's rejection dialog previews it.
 */
export function receiptRejectedText(
  language: Language,
  number: number,
  reason: ReceiptRejectReasonKey,
  note?: string | null,
): string {
  const t = botMessages[language].bot;
  const why =
    reason === 'other'
      ? (note ?? '')
      : [
          ordersMessages[language].orders.receiptRejectReason[reason],
          ...(note ? [fill(t.rejectNote, { note })] : []),
        ].join('\n');
  return fill(t.receiptRejected, { number: String(number), reason: why });
}

/** Why an order was cancelled (contracts `CANCEL_REASONS`). */
export type CancelReasonKey = keyof (typeof ordersMessages)['ru']['orders']['cancelReason'];

/**
 * The shopper's «Отменён» message: the reason as a sentence in their language, and for a paid
 * order the line that the manager will be in touch to return the money (ADR 0006). The bot sends
 * it and the admin's cancel dialog previews it.
 */
export function orderCancelledText(
  language: Language,
  number: number,
  reason: CancelReasonKey,
  paid: boolean,
): string {
  const t = botMessages[language].bot;
  const text = fill(t.orderCancelled, {
    number: String(number),
    reason: ordersMessages[language].orders.cancelReason[reason],
  });
  return paid ? `${text}\n${t.refundNote}` : text;
}

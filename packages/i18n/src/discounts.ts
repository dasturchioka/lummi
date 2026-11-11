import { defineMessages } from './define';

/**
 * Profile «Мои скидки» and the date of birth (ticket #30), with the upgrade rights (#38). Its own
 * namespace (`@lummi/i18n/discounts`), imported only by the lazy Profile and checkout, so the Mini
 * App's first screen does not carry these strings (ADR 0030 budget). Keys must match in both
 * languages or typecheck fails.
 */
export const discountsMessages = defineMessages(
  {
    discounts: {
      title: 'Мои скидки',
      coupon: 'Купон ко дню рождения',
      /** An active coupon: what it gives. `{max}` is money. */
      couponTerms: 'На ароматы, до {max}. В корзине применится сам.',
      daysLeft: {
        one: 'Остался {n} день',
        few: 'Осталось {n} дня',
        many: 'Осталось {n} дней',
        other: 'Осталось {n} дня',
      },
      lastDay: 'Последний день',
      /** `{date}`: «21 марта». */
      until: 'до {date}',
      /** No coupon yet: «−20% · появится 11 марта, за 3 дня до дня рождения» (mockup 08). */
      upcoming: '−{percent}% · появится {date}, за {days} до дня рождения',
      upcomingOnTheDay: '−{percent}% · появится {date}, в день рождения',
      days: { one: '{n} день', few: '{n} дня', many: '{n} дней', other: '{n} дня' },
      birthDate: 'Дата рождения: {date}',
      /** No date yet. */
      invite: 'Укажите дату рождения, и за {days} до праздника здесь появится купон −{percent}%.',
      inviteOnTheDay: 'Укажите дату рождения, и в день рождения здесь появится купон −{percent}%.',
      inviteAction: 'Указать дату рождения',
      /** Only staff correct the date; `{manager}` is the «Напишите менеджеру» link. */
      wrongDate: 'Ошиблись в дате? {manager}',
      wrongDateManager: 'Напишите менеджеру',
      loadFailed: 'Не удалось загрузить скидки.',
      /** The one-time entry sheet. */
      sheetTitle: 'Дата рождения',
      sheetText:
        'Пришлём купон −{percent}% за {days} до дня рождения. Дату можно указать только один раз, проверьте её.',
      sheetTextOnTheDay:
        'Пришлём купон −{percent}% в день рождения. Дату можно указать только один раз, проверьте её.',
      field: 'Дата рождения',
      /** The mask the field takes: day, month, year. */
      placeholder: 'ДД.ММ.ГГГГ',
      save: 'Сохранить',
      formatError: 'Введите дату как ДД.ММ.ГГГГ',
      rangeError: 'Проверьте дату рождения',
      saveFailed: 'Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.',
      alreadySet: 'Дата рождения уже указана.',
      /** Checkout, under the optional field (mockup 06). */
      checkoutHint: 'Пришлём купон −{percent}% ко дню рождения. Дату можно указать один раз.',
      /** A valid date read back in words before it is stored for good. `{date}`: «14 марта 1996». */
      confirmDate: '{date} — изменить потом нельзя, проверьте',
      /** The cart: an entered promo code keeps the coupon out (ADR 0002). `{date}`: its last day. */
      couponWaits:
        'Купон ко дню рождения −{percent}% не суммируется с промокодом и ждёт вас до {date}.',
      useCoupon: 'Применить купон',
      /** The cart: an entered promo code keeps the upgrade right out (ADR 0002). `{date}`: its last day. */
      rightWaits: {
        set: 'Скидка за набор −{percent}% не суммируется с промокодом и ждёт вас до {date}.',
        single_10ml:
          'Скидка −{percent}% за флакон 10 мл не суммируется с промокодом и ждёт вас до {date}.',
      },
      useRight: 'Применить скидку',
      /** An open upgrade right (TZ §3.4: «видна в профиле»). */
      right: { set: 'Скидка за набор', single_10ml: 'Скидка за флакон 10 мл' },
      rightTerms: {
        set: 'На один полный флакон любого аромата из набора. В корзине применится сама.',
        single_10ml: 'На один полный флакон этого аромата. В корзине применится сама.',
      },
    },
  },
  {
    discounts: {
      title: 'Mening chegirmalarim',
      coupon: 'Tugʻilgan kun kuponi',
      couponTerms: 'Iforlarga, {max}gacha. Savatda oʻzi qoʻllanadi.',
      daysLeft: {
        one: '{n} kun qoldi',
        few: '{n} kun qoldi',
        many: '{n} kun qoldi',
        other: '{n} kun qoldi',
      },
      lastDay: 'Oxirgi kun',
      until: '{date}gacha',
      upcoming: '−{percent}% · {date}da, tugʻilgan kuningizdan {days} oldin keladi',
      upcomingOnTheDay: '−{percent}% · {date}da, tugʻilgan kuningizda keladi',
      days: { one: '{n} kun', few: '{n} kun', many: '{n} kun', other: '{n} kun' },
      birthDate: 'Tugʻilgan sana: {date}',
      invite:
        'Tugʻilgan sanangizni kiriting: bayramdan {days} oldin bu yerda −{percent}% kupon paydo boʻladi.',
      inviteOnTheDay:
        'Tugʻilgan sanangizni kiriting: tugʻilgan kuningizda bu yerda −{percent}% kupon paydo boʻladi.',
      inviteAction: 'Tugʻilgan sanani kiritish',
      wrongDate: 'Sanada xato bormi? {manager}',
      wrongDateManager: 'Menejerga yozing',
      loadFailed: 'Chegirmalarni yuklab boʻlmadi.',
      sheetTitle: 'Tugʻilgan sana',
      sheetText:
        'Tugʻilgan kuningizdan {days} oldin −{percent}% kupon yuboramiz. Sanani faqat bir marta kiritish mumkin, tekshirib oling.',
      sheetTextOnTheDay:
        'Tugʻilgan kuningizda −{percent}% kupon yuboramiz. Sanani faqat bir marta kiritish mumkin, tekshirib oling.',
      field: 'Tugʻilgan sana',
      placeholder: 'KK.OO.YYYY',
      save: 'Saqlash',
      formatError: 'Sanani KK.OO.YYYY koʻrinishida kiriting',
      rangeError: 'Tugʻilgan sanani tekshiring',
      saveFailed: 'Saqlab boʻlmadi. Internetni tekshirib, qaytadan urinib koʻring.',
      alreadySet: 'Tugʻilgan sana allaqachon kiritilgan.',
      checkoutHint:
        'Tugʻilgan kuningizga −{percent}% kupon yuboramiz. Sanani faqat bir marta kiritish mumkin.',
      confirmDate: '{date} — keyin oʻzgartirib boʻlmaydi, tekshirib oling',
      couponWaits:
        'Tugʻilgan kun kuponi −{percent}% promokod bilan qoʻshilmaydi va {date}gacha sizni kutadi.',
      useCoupon: 'Kuponni qoʻllash',
      rightWaits: {
        set: 'Toʻplam uchun −{percent}% chegirma promokod bilan qoʻshilmaydi va {date}gacha sizni kutadi.',
        single_10ml:
          '10 ml flakon uchun −{percent}% chegirma promokod bilan qoʻshilmaydi va {date}gacha sizni kutadi.',
      },
      useRight: 'Chegirmani qoʻllash',
      right: { set: 'Toʻplam chegirmasi', single_10ml: '10 ml flakon chegirmasi' },
      rightTerms: {
        set: 'Toʻplamdagi istalgan iforning bitta toʻliq flakoniga. Savatda oʻzi qoʻllanadi.',
        single_10ml: 'Shu iforning bitta toʻliq flakoniga. Savatda oʻzi qoʻllanadi.',
      },
    },
  },
);
export type DiscountsMessages = (typeof discountsMessages)['ru'];

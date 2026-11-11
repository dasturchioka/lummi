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
      /** The cart's discount switch (#39, ADR 0002; mockup 10-cart-discount). */
      choice: {
        title: 'Скидка',
        hint: 'Одна скидка на заказ. Без промокода мы сами выбираем самую выгодную.',
        /** Over the right-hand column of the rows. */
        total: 'Итого',
        /** A row, by its source: an upgrade right by where it came from. */
        option: {
          set: 'Скидка за набор −{percent}%',
          single_10ml: 'Скидка за 10 мл −{percent}%',
          birthday_coupon: 'Купон ко дню рождения −{percent}%',
        },
        none: 'Не применять',
        /** Under «Не применять» while an entitlement is among the choices. */
        noneKeeps: 'Скидка сохранится на следующий заказ',
        /** What an upgrade right discounts: «Tygar 30 мл». */
        bottle: '{name} {ml} мл',
        /** An entered code is cheaper than none of the entitlements: `{amount}` is money. */
        better: {
          set: 'Скидка за набор выгоднее на {amount}',
          single_10ml: 'Скидка за 10 мл выгоднее на {amount}',
          birthday_coupon: 'Купон ко дню рождения выгоднее на {amount}',
        },
        switchTo: 'Переключить',
        /**
         * The chosen discount was used, ended or stopped covering the cart, or a tapped one was no
         * longer offered: which one, and what the cart applies now.
         */
        lapsed: {
          text: '{what} больше не действует — {now}.',
          what: {
            set: 'Скидка за набор',
            single_10ml: 'Скидка за 10 мл',
            birthday_coupon: 'Купон ко дню рождения',
            promo_code: 'Промокод {code}',
            unknown: 'Выбранная скидка',
          },
          now: {
            set: 'применили скидку за набор',
            single_10ml: 'применили скидку за 10 мл',
            birthday_coupon: 'применили купон ко дню рождения',
            promo_code: 'применили промокод {code}',
            none: 'сейчас скидки нет',
          },
        },
        /** Under the stored code while «Не применять» is chosen. */
        codeOff: 'Сейчас скидка не применяется',
      },
      /** The fragrance card: the customer's right on the chosen full-size volume (TZ §3.4). */
      cardDeal: { set: 'Скидка за набор −{percent}%', single_10ml: 'Скидка за 10 мл −{percent}%' },
      /** Under it, what it covers. `{volumes}`: «30 или 50» from the setting. */
      cardDealTerms: 'на один флакон {volumes} мл · применится в корзине',
      /** Joins the last two full-size volumes: «30 или 50». */
      volumesOr: 'или',
      /** The cart line the right discounts (one bottle of it). */
      lineDeal: {
        set: 'Скидка за набор −{percent}% на один флакон',
        single_10ml: 'Скидка за 10 мл −{percent}% на один флакон',
      },
      /** «Мои скидки»: the order that opened the right, so two rights are told apart. */
      rightSource: {
        set: 'Набор из заказа № {number}',
        single_10ml: 'Флакон 10 мл из заказа № {number}',
      },
      /** An open upgrade right (TZ §3.4: «видна в профиле»). */
      right: { set: 'Скидка за набор', single_10ml: 'Скидка за флакон 10 мл' },
      rightTerms: {
        set: 'На один полный флакон {volumes} мл любого аромата из набора. В корзине применится сама.',
        single_10ml: 'На один полный флакон {volumes} мл этого аромата. В корзине применится сама.',
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
      choice: {
        title: 'Chegirma',
        hint: 'Bitta buyurtmaga bitta chegirma. Promokodsiz eng foydalisini oʻzimiz tanlaymiz.',
        total: 'Jami',
        option: {
          set: 'Toʻplam chegirmasi −{percent}%',
          single_10ml: '10 ml uchun chegirma −{percent}%',
          birthday_coupon: 'Tugʻilgan kun kuponi −{percent}%',
        },
        none: 'Qoʻllamaslik',
        noneKeeps: 'Chegirma keyingi buyurtmaga saqlanadi',
        bottle: '{name} {ml} ml',
        better: {
          set: 'Toʻplam chegirmasi {amount} foydaliroq',
          single_10ml: '10 ml uchun chegirma {amount} foydaliroq',
          birthday_coupon: 'Tugʻilgan kun kuponi {amount} foydaliroq',
        },
        switchTo: 'Almashtirish',
        lapsed: {
          text: '{what} endi amal qilmaydi — {now}.',
          what: {
            set: 'Toʻplam chegirmasi',
            single_10ml: '10 ml uchun chegirma',
            birthday_coupon: 'Tugʻilgan kun kuponi',
            promo_code: '{code} promokodi',
            unknown: 'Tanlangan chegirma',
          },
          now: {
            set: 'toʻplam chegirmasi qoʻllandi',
            single_10ml: '10 ml uchun chegirma qoʻllandi',
            birthday_coupon: 'tugʻilgan kun kuponi qoʻllandi',
            promo_code: '{code} promokodi qoʻllandi',
            none: 'hozir chegirma yoʻq',
          },
        },
        codeOff: 'Hozir chegirma qoʻllanmayapti',
      },
      cardDeal: {
        set: 'Toʻplam chegirmasi −{percent}%',
        single_10ml: '10 ml uchun chegirma −{percent}%',
      },
      cardDealTerms: 'bitta {volumes} ml flakonga · savatda qoʻllanadi',
      volumesOr: 'yoki',
      lineDeal: {
        set: 'Toʻplam chegirmasi −{percent}% bitta flakonga',
        single_10ml: '10 ml uchun chegirma −{percent}% bitta flakonga',
      },
      rightSource: {
        set: '№ {number} buyurtmadagi toʻplam',
        single_10ml: '№ {number} buyurtmadagi 10 ml flakon',
      },
      right: { set: 'Toʻplam chegirmasi', single_10ml: '10 ml flakon chegirmasi' },
      rightTerms: {
        set: 'Toʻplamdagi istalgan iforning bitta toʻliq {volumes} ml flakoniga. Savatda oʻzi qoʻllanadi.',
        single_10ml: 'Shu iforning bitta toʻliq {volumes} ml flakoniga. Savatda oʻzi qoʻllanadi.',
      },
    },
  },
);
export type DiscountsMessages = (typeof discountsMessages)['ru'];

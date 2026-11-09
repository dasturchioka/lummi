import { defineMessages } from './define';

/** Mini App screens. Import from `@lummi/i18n/miniapp`. Keys must match in both languages or typecheck fails. */
export const miniappMessages = defineMessages(
  {
    tabs: {
      home: 'Главная',
      catalog: 'Каталог',
      cart: 'Корзина',
      orders: 'Заказы',
      profile: 'Профиль',
    },
    home: {
      slogan: 'Ароматы, которые освещают',
      search: 'Поиск',
      delivery: 'Доставка',
      chooseCity: 'Выберите город',
      changeCity: 'Сменить город доставки',
      emptyTitle: 'Скоро здесь появятся ароматы',
      emptyText: 'Мы собираем коллекцию. Загляните чуть позже.',
    },
    /** The empty screens behind the tabs until their tickets build them. */
    placeholder: {
      catalog: {
        title: 'Каталог скоро откроется',
        text: 'Здесь будут все ароматы LUMMI в 10, 30 и 50 мл.',
      },
      cart: {
        title: 'Корзина скоро откроется',
        text: 'Сюда попадут ароматы, которые вы выберете.',
      },
      orders: {
        title: 'Здесь появятся ваши заказы',
        text: 'Вы сможете следить за каждым заказом: от оплаты до доставки.',
      },
    },
    /** Region -> city -> BTS point picker and the Home delivery city (spec Changes 2026-11-07). */
    delivery: {
      cityTitle: 'Город доставки',
      cityText: 'Выберите регион, затем город или район.',
      pointTitle: 'Пункт BTS',
      pointText: 'Выберите, где вам удобно забрать заказ.',
      regions: 'Регион',
      cities: 'Город или район',
      points: 'Пункты BTS',
      back: 'Назад',
      pointsCount: {
        one: '{n} пункт',
        few: '{n} пункта',
        many: '{n} пунктов',
        other: '{n} пункта',
      },
      searchPoints: 'Найти пункт: район, улица, название',
      searchCities: 'Найти город или район',
      selected: 'Выбрано',
      searchResults: 'Найдено в разных регионах',
      noResultsTitle: 'Ничего не нашли',
      noResultsText: 'Попробуйте другое слово или выберите пункт по региону.',
      noCitiesTitle: 'В этом регионе пока нет пунктов',
      noCitiesText: 'Выберите другой регион или укажите свой вариант.',
      notFound: 'Нет вашего пункта? Укажите адрес вручную',
      typedText:
        'Напишите город или район и ближайший ориентир. Менеджер подберёт пункт BTS и свяжется с вами.',
      typedRegion: 'Регион',
      typedLabel: 'Адрес',
      typedPlaceholder: 'Город или район, улица, ориентир',
      typedSubmit: 'Готово',
      typedTooShort: 'Напишите хотя бы несколько слов',
      clearSearch: 'Очистить поиск',
      saveFailed: 'Не удалось сохранить город. Попробуйте ещё раз.',
      /** The chosen point, collapsed (checkout). `{city}` stays in the nominative: city names are not declined. */
      change: 'Сменить',
      moreInCity: {
        one: '{city}: ещё {n} пункт',
        few: '{city}: ещё {n} пункта',
        many: '{city}: ещё {n} пунктов',
        other: '{city}: ещё {n} пункта',
      },
    },
    profile: {
      title: 'Профиль',
      language: 'Язык',
      theme: 'Тема',
      themeLight: 'Светлая',
      themeDark: 'Тёмная',
      guest: 'Гость',
    },
    session: {
      reopenTitle: 'Откройте приложение заново',
      reopenText:
        'Для безопасности сессия закончилась. Закройте LUMMI и откройте снова из чата с ботом.',
    },
  },
  {
    tabs: {
      home: 'Asosiy',
      catalog: 'Katalog',
      cart: 'Savat',
      orders: 'Buyurtmalar',
      profile: 'Profil',
    },
    home: {
      slogan: 'Lahzalaringizni yorituvchi iforlar',
      search: 'Qidiruv',
      delivery: 'Yetkazish',
      chooseCity: 'Shaharni tanlang',
      changeCity: 'Yetkazish shahrini oʻzgartirish',
      emptyTitle: 'Tez orada bu yerda iforlar paydo boʻladi',
      emptyText: 'Kolleksiyani tayyorlayapmiz. Birozdan keyin kiring.',
    },
    placeholder: {
      catalog: {
        title: 'Katalog tez orada ochiladi',
        text: 'Bu yerda LUMMI’ning barcha iforlari boʻladi: 10, 30 va 50 ml.',
      },
      cart: {
        title: 'Savat tez orada ochiladi',
        text: 'Tanlagan iforlaringiz shu yerda boʻladi.',
      },
      orders: {
        title: 'Buyurtmalaringiz shu yerda boʻladi',
        text: 'Har bir buyurtmangizni toʻlovdan yetkazib berishgacha kuzatib borasiz.',
      },
    },
    delivery: {
      cityTitle: 'Yetkazish shahri',
      cityText: 'Viloyatni, keyin shahar yoki tumanni tanlang.',
      pointTitle: 'BTS punkti',
      pointText: 'Buyurtmani qayerdan olib ketishingiz qulay boʻlsa, oʻshani tanlang.',
      regions: 'Viloyat',
      cities: 'Shahar yoki tuman',
      points: 'BTS punktlari',
      back: 'Orqaga',
      pointsCount: {
        one: '{n} ta punkt',
        few: '{n} ta punkt',
        many: '{n} ta punkt',
        other: '{n} ta punkt',
      },
      searchPoints: 'Punktni topish: tuman, koʻcha, nomi',
      searchCities: 'Shahar yoki tumanni topish',
      selected: 'Tanlandi',
      searchResults: 'Turli viloyatlardan topildi',
      noResultsTitle: 'Hech narsa topilmadi',
      noResultsText: 'Boshqa soʻz yozing yoki punktni viloyat boʻyicha tanlang.',
      noCitiesTitle: 'Bu viloyatda hozircha punkt yoʻq',
      noCitiesText: 'Boshqa viloyatni tanlang yoki oʻz variantingizni yozing.',
      notFound: 'Punktingiz yoʻqmi? Manzilni qoʻlda yozing',
      typedText:
        'Shahar yoki tumanni va yaqin moʻljalni yozing. Menejer BTS punktini tanlab, siz bilan bogʻlanadi.',
      typedRegion: 'Viloyat',
      typedLabel: 'Manzil',
      typedPlaceholder: 'Shahar yoki tuman, koʻcha, moʻljal',
      typedSubmit: 'Tayyor',
      typedTooShort: 'Kamida bir necha soʻz yozing',
      clearSearch: 'Qidiruvni tozalash',
      saveFailed: 'Shaharni saqlab boʻlmadi. Qaytadan urinib koʻring.',
      change: 'Oʻzgartirish',
      moreInCity: {
        one: '{city}: yana {n} ta punkt',
        few: '{city}: yana {n} ta punkt',
        many: '{city}: yana {n} ta punkt',
        other: '{city}: yana {n} ta punkt',
      },
    },
    profile: {
      title: 'Profil',
      language: 'Til',
      theme: 'Mavzu',
      themeLight: 'Yorugʻ',
      themeDark: 'Qorongʻi',
      guest: 'Mehmon',
    },
    session: {
      reopenTitle: 'Ilovani qaytadan oching',
      reopenText: 'Xavfsizlik uchun seans tugadi. LUMMI’ni yoping va bot chatidan qayta oching.',
    },
  },
);
export type MiniappMessages = (typeof miniappMessages)['ru'];

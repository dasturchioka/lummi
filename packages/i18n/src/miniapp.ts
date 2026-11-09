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
    card: {
      back: 'Назад',
      share: 'Поделиться',
      basedOn: 'по мотивам {brand}',
      type: { homme: 'Homme', femme: 'Femme', unisex: 'Unisex' },
      hit: 'Хит',
      isNew: 'Новинка',
      whenToWear: 'Когда носить',
      traits: { longevity: 'Стойкость', sillage: 'Шлейф', season: 'Сезон', time: 'Время' },
      sillage: { medium: 'Средний', noticeable: 'Заметный', strong: 'Сильный' },
      season: {
        spring_summer: 'Весна–лето',
        autumn_winter: 'Осень–зима',
        all_year: 'Круглый год',
        spring_autumn: 'Весна–осень',
      },
      time: {
        day: 'Днём',
        evening: 'Вечер',
        day_evening: 'День и вечер',
        everyday: 'На каждый день',
      },
      volume: 'Объём',
      ml: 'мл',
      soldOut: 'нет в наличии',
      inStock: 'В наличии',
      unavailable: 'Нет в наличии',
      saleUntil: 'до {date}',
      notes: { top: 'Верх', heart: 'Сердце', base: 'База' },
      uzum: 'Купить на Uzum',
      disclaimer: 'Аромат LUMMI по мотивам, не оригинальный парфюм',
      notFoundTitle: 'Аромат не найден',
      notFoundText: 'Возможно, он больше не в продаже. Посмотрите другие ароматы.',
      toCatalog: 'В каталог',
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
    card: {
      back: 'Orqaga',
      share: 'Ulashish',
      basedOn: '{brand} asosida',
      type: { homme: 'Homme', femme: 'Femme', unisex: 'Unisex' },
      hit: 'Hit',
      isNew: 'Yangi',
      whenToWear: 'Qachon taqish kerak',
      traits: { longevity: 'Turgʻunlik', sillage: 'Iz', season: 'Mavsum', time: 'Vaqt' },
      sillage: { medium: 'Oʻrtacha', noticeable: 'Sezilarli', strong: 'Kuchli' },
      season: {
        spring_summer: 'Bahor–yoz',
        autumn_winter: 'Kuz–qish',
        all_year: 'Yil boʻyi',
        spring_autumn: 'Bahor–kuz',
      },
      time: {
        day: 'Kunduzi',
        evening: 'Kechqurun',
        day_evening: 'Kunduzi va kechqurun',
        everyday: 'Har kuni',
      },
      volume: 'Hajm',
      ml: 'ml',
      soldOut: 'sotuvda yoʻq',
      inStock: 'Sotuvda bor',
      unavailable: 'Sotuvda yoʻq',
      saleUntil: '{date}',
      notes: { top: 'Yuqori', heart: 'Yurak', base: 'Baza' },
      uzum: 'Uzum’da sotib olish',
      disclaimer: 'LUMMI ifori ilhom asosida yaratilgan, asl parfyum emas',
      notFoundTitle: 'Ifor topilmadi',
      notFoundText: 'Ehtimol, u endi sotuvda yoʻq. Boshqa iforlarni koʻring.',
      toCatalog: 'Katalogga',
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

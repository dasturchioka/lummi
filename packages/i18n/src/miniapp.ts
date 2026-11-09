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
    profile: {
      title: 'Профиль',
      language: 'Язык',
      theme: 'Тема',
      themeLight: 'Светлая',
      themeDark: 'Тёмная',
      guest: 'Гость',
      phone: 'Телефон',
      phoneAdd: 'Добавить',
    },
    registration: {
      title: 'Ваш номер телефона',
      text: 'Нужен для первого заказа: по нему мы узнаем вас в следующий раз.',
      phoneWhy: 'Поделитесь контактом из Telegram. Номер вводить не нужно.',
      writeWhy: 'И разрешите боту писать вам: так вы получите статус заказа в чат.',
      share: 'Поделиться контактом',
      privacy: 'Номер видят только мы. Без разрешения писать статусы будут в приложении.',
      denied: 'Без контакта оформить заказ нельзя. Попробуйте ещё раз.',
      unsupported: 'Эта версия Telegram не умеет делиться контактом. Обновите Telegram.',
      failed: 'Не получилось. Проверьте соединение и повторите.',
      foreign: 'Это контакт другого аккаунта. Поделитесь своим.',
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
    profile: {
      title: 'Profil',
      language: 'Til',
      theme: 'Mavzu',
      themeLight: 'Yorugʻ',
      themeDark: 'Qorongʻi',
      guest: 'Mehmon',
      phone: 'Telefon',
      phoneAdd: 'Qoʻshish',
    },
    registration: {
      title: 'Telefon raqamingiz',
      text: 'Birinchi buyurtma uchun kerak: keyingi safar sizni shu raqam orqali taniymiz.',
      phoneWhy: 'Telegramdagi kontaktingizni ulashing. Raqamni yozish shart emas.',
      writeWhy: 'Botga yozishga ruxsat bering: buyurtma holati chatga keladi.',
      share: 'Kontaktni ulashish',
      privacy: 'Raqamni faqat biz koʻramiz. Ruxsatsiz holatlar ilovada koʻrinadi.',
      denied: 'Kontaktsiz buyurtma berib boʻlmaydi. Qaytadan urinib koʻring.',
      unsupported: 'Telegramning bu versiyasi kontakt ulasha olmaydi. Telegramni yangilang.',
      failed: 'Chiqmadi. Internetni tekshiring va qayta urinib koʻring.',
      foreign: 'Bu boshqa akkauntning kontakti. Oʻzingizniki bilan ulashing.',
    },
    session: {
      reopenTitle: 'Ilovani qaytadan oching',
      reopenText: 'Xavfsizlik uchun seans tugadi. LUMMI’ni yoping va bot chatidan qayta oching.',
    },
  },
);
export type MiniappMessages = (typeof miniappMessages)['ru'];

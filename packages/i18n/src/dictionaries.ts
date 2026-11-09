import type { Language } from './language';

/** ru is the reference; uz must have exactly the same keys, or typecheck fails. */
export const ru = {
  common: {
    currency: 'сум',
    retry: 'Повторить',
    loading: 'Загрузка',
    close: 'Закрыть',
  },
  bot: {
    greeting:
      'Добро пожаловать в LUMMI.\nExtrait de Parfum по мотивам известных ароматов. Откройте магазин и выберите свой.',
    openShop: 'Открыть магазин',
    alertPrefix: 'Системное сообщение',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    sessionExpired: 'Сессия истекла. Откройте приложение заново.',
    loadFailedTitle: 'Не удалось загрузить',
    loadFailedText: 'Проверьте соединение и повторите.',
    reopenTitle: 'Откройте приложение заново',
    reopenText:
      'Для безопасности сессия закончилась. Закройте LUMMI и откройте снова из чата с ботом.',
  },
  tabs: {
    home: 'Главная',
    catalog: 'Каталог',
    cart: 'Корзина',
    orders: 'Заказы',
    profile: 'Профиль',
  },
  home: {
    slogan: 'Ароматы, которые освещают',
    emptyTitle: 'Скоро здесь появятся ароматы',
    emptyText: 'Мы собираем коллекцию. Загляните чуть позже.',
  },
  placeholder: {
    emptyTitle: 'Раздел скоро откроется',
    emptyText: 'Мы уже работаем над ним.',
  },
  profile: {
    title: 'Профиль',
    language: 'Язык',
    theme: 'Тема',
    themeLight: 'Светлая',
    themeDark: 'Тёмная',
    guest: 'Гость',
  },
} as const;

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
export type Messages = DeepString<typeof ru>;

export const uz: Messages = {
  common: {
    currency: 'soʻm',
    retry: 'Qayta urinish',
    loading: 'Yuklanmoqda',
    close: 'Yopish',
  },
  bot: {
    greeting:
      'LUMMI ga xush kelibsiz.\nMashhur atirlar asosidagi Extrait de Parfum. Doʻkonni oching va oʻzingizni tanlang.',
    openShop: 'Doʻkonni ochish',
    alertPrefix: 'Tizim xabari',
  },
  errors: {
    generic: 'Nimadir xato ketdi. Qaytadan urinib koʻring.',
    sessionExpired: 'Seans tugadi. Ilovani qaytadan oching.',
    loadFailedTitle: 'Yuklab boʻlmadi',
    loadFailedText: 'Internetni tekshiring va qayta urinib koʻring.',
    reopenTitle: 'Ilovani qaytadan oching',
    reopenText: 'Xavfsizlik uchun seans tugadi. LUMMI’ni yoping va bot chatidan qayta oching.',
  },
  tabs: {
    home: 'Bosh sahifa',
    catalog: 'Katalog',
    cart: 'Savat',
    orders: 'Buyurtmalar',
    profile: 'Profil',
  },
  home: {
    slogan: 'Yoritadigan xushboʻyliklar',
    emptyTitle: 'Tez orada bu yerda atirlar paydo boʻladi',
    emptyText: 'Kolleksiyani tayyorlayapmiz. Birozdan keyin kiring.',
  },
  placeholder: {
    emptyTitle: 'Boʻlim tez orada ochiladi',
    emptyText: 'Ustida ishlayapmiz.',
  },
  profile: {
    title: 'Profil',
    language: 'Til',
    theme: 'Mavzu',
    themeLight: 'Yorugʻ',
    themeDark: 'Qorongʻi',
    guest: 'Mehmon',
  },
};

export const dictionaries: Record<Language, Messages> = { ru, uz };

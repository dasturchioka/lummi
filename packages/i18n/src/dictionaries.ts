import type { Language } from './language';

/** ru is the reference; uz must have exactly the same keys, or typecheck fails. */
export const ru = {
  common: {
    currency: 'сум',
  },
  errors: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    sessionExpired: 'Сессия истекла. Откройте приложение заново.',
  },
  admin: {
    brand: 'LUMMI.',
    nav: { home: 'Главная', staff: 'Сотрудники', signOut: 'Выйти' },
    roles: { owner: 'Владелец', manager: 'Менеджер' },
    login: {
      title: 'Вход в панель',
      hint: 'Войдите через Telegram. Доступ только у сотрудников LUMMI.',
      devHint: 'Режим разработки: вход без виджета Telegram.',
      devTelegramId: 'Telegram ID сотрудника',
      devSubmit: 'Войти',
      widgetMissing: 'Не задан бот для входа (NEXT_PUBLIC_BOT_USERNAME).',
    },
    errors: {
      noAccess: 'Нет доступа',
      noAccessHint: 'Этот аккаунт Telegram не входит в состав сотрудников. Обратитесь к владельцу.',
      invalidLogin: 'Не удалось проверить вход через Telegram. Попробуйте ещё раз.',
      expiredLogin: 'Вход устарел. Попробуйте ещё раз.',
      forbidden: 'Только для владельца',
      conflict: 'Действие невозможно: такой сотрудник уже есть или это владелец.',
      generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    },
    home: { title: 'Панель', empty: 'Здесь появятся заказы, каталог и настройки.' },
    staff: {
      title: 'Сотрудники',
      add: 'Добавить менеджера',
      telegramId: 'Telegram ID',
      name: 'Имя',
      role: 'Роль',
      status: 'Статус',
      active: 'Активен',
      inactive: 'Отключён',
      deactivate: 'Отключить',
      activate: 'Включить',
      remove: 'Удалить',
      confirmRemove: 'Удалить сотрудника? Вернуть его можно только добавлением заново.',
      empty: 'Сотрудников пока нет.',
      saved: 'Сохранено',
    },
    language: 'Язык',
  },
} as const;

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
export type Messages = DeepString<typeof ru>;

export const uz: Messages = {
  common: {
    currency: 'soʻm',
  },
  errors: {
    generic: 'Nimadir xato ketdi. Qaytadan urinib koʻring.',
    sessionExpired: 'Seans tugadi. Ilovani qaytadan oching.',
  },
  admin: {
    brand: 'LUMMI.',
    nav: { home: 'Bosh sahifa', staff: 'Xodimlar', signOut: 'Chiqish' },
    roles: { owner: 'Egasi', manager: 'Menejer' },
    login: {
      title: 'Panelga kirish',
      hint: 'Telegram orqali kiring. Kirish faqat LUMMI xodimlari uchun.',
      devHint: 'Ishlab chiqish rejimi: Telegram vidjetisiz kirish.',
      devTelegramId: 'Xodimning Telegram ID raqami',
      devSubmit: 'Kirish',
      widgetMissing: 'Kirish boti sozlanmagan (NEXT_PUBLIC_BOT_USERNAME).',
    },
    errors: {
      noAccess: 'Ruxsat yoʻq',
      noAccessHint: 'Bu Telegram akkaunti xodimlar roʻyxatida yoʻq. Egasiga murojaat qiling.',
      invalidLogin: 'Telegram orqali kirishni tekshirib boʻlmadi. Qaytadan urinib koʻring.',
      expiredLogin: 'Kirish muddati tugagan. Qaytadan urinib koʻring.',
      forbidden: 'Faqat egasi uchun',
      conflict: 'Amalni bajarib boʻlmaydi: bunday xodim bor yoki bu egasi.',
      generic: 'Nimadir xato ketdi. Qaytadan urinib koʻring.',
    },
    home: { title: 'Panel', empty: 'Bu yerda buyurtmalar, katalog va sozlamalar paydo boʻladi.' },
    staff: {
      title: 'Xodimlar',
      add: 'Menejer qoʻshish',
      telegramId: 'Telegram ID',
      name: 'Ism',
      role: 'Rol',
      status: 'Holat',
      active: 'Faol',
      inactive: 'Oʻchirilgan',
      deactivate: 'Oʻchirib qoʻyish',
      activate: 'Yoqish',
      remove: 'Olib tashlash',
      confirmRemove: 'Xodimni olib tashlaysizmi? Uni faqat qaytadan qoʻshib tiklash mumkin.',
      empty: 'Hozircha xodimlar yoʻq.',
      saved: 'Saqlandi',
    },
    language: 'Til',
  },
};

export const dictionaries: Record<Language, Messages> = { ru, uz };

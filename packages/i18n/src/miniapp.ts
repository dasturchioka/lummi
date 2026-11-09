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
      phoneWhy: 'Нужен для заказа и доставки',
      phoneFrom: 'Из Telegram',
    },
    registration: {
      title: 'Ваш номер телефона',
      text: 'Номер нужен для оформления и доставки BTS.',
      contactTitle: 'Номер из Telegram',
      contactText: 'Вводить не нужно: Telegram передаст его сам.',
      writeTitle: 'Сообщения от бота — по желанию',
      writeText: 'Пришлём статус заказа в чат. Без этого статусы будут в «Заказах».',
      share: 'Поделиться контактом',
      later: 'Не сейчас',
      understood: 'Понятно',
      waiting: 'Ответьте на запрос Telegram.',
      denied: 'Хорошо. Без номера мы не сможем доставить заказ — поделитесь, когда будете готовы.',
      failed: 'Номер не сохранился. Проверьте соединение и повторите.',
      foreign: 'Это контакт другого аккаунта Telegram. Поделитесь своим.',
      expired: 'Подтверждение устарело. Повторите, это займёт пару секунд.',
      doneTitle: 'Номер сохранён',
      doneChat: 'Статусы заказа придут в чат с ботом.',
      doneInApp: 'Статусы заказа будут в разделе «Заказы».',
      takenTitle: 'Этот номер уже есть в LUMMI',
      takenText:
        'Он привязан к другому аккаунту Telegram. Напишите менеджеру, поможем разобраться.',
      writeManager: 'Написать менеджеру',
      updateTitle: 'Нужна новая версия Telegram',
      updateText: 'Обновите Telegram, чтобы поделиться номером, и откройте LUMMI снова.',
      browserTitle: 'Откройте LUMMI в Telegram',
      browserText: 'Поделиться контактом можно только в приложении Telegram, не в браузере.',
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
      phoneWhy: 'Buyurtma va yetkazib berish uchun',
      phoneFrom: 'Telegram’dan',
    },
    registration: {
      title: 'Telefon raqamingiz',
      text: 'Raqam buyurtmani rasmiylashtirish va BTS orqali yetkazish uchun kerak.',
      contactTitle: 'Raqam Telegramdan',
      contactText: 'Yozish shart emas: Telegram uni oʻzi yuboradi.',
      writeTitle: 'Bot xabarlari — ixtiyoriy',
      writeText:
        'Buyurtma holatini chatga yuboramiz. Busiz holat «Buyurtmalar» boʻlimida koʻrinadi.',
      share: 'Kontaktni ulashish',
      later: 'Hozir emas',
      understood: 'Tushunarli',
      waiting: 'Telegram soʻroviga javob bering.',
      denied: 'Mayli. Raqamsiz buyurtmani yetkazib bera olmaymiz — tayyor boʻlganingizda ulashing.',
      failed: 'Raqam saqlanmadi. Internetni tekshiring va qayta urinib koʻring.',
      foreign: 'Bu boshqa Telegram akkauntining kontakti. Oʻzingiznikini ulashing.',
      expired: 'Tasdiq eskirdi. Qayta urinib koʻring, bir necha soniya oladi.',
      doneTitle: 'Raqam saqlandi',
      doneChat: 'Buyurtma holati bot chatiga keladi.',
      doneInApp: 'Buyurtma holati «Buyurtmalar» boʻlimida koʻrinadi.',
      takenTitle: 'Bu raqam LUMMI’da allaqachon bor',
      takenText: 'U boshqa Telegram akkauntiga bogʻlangan. Menejerga yozing, birga hal qilamiz.',
      writeManager: 'Menejerga yozish',
      updateTitle: 'Telegramning yangi versiyasi kerak',
      updateText: 'Raqamni ulashish uchun Telegramni yangilang va LUMMI’ni qayta oching.',
      browserTitle: 'LUMMI’ni Telegramda oching',
      browserText: 'Kontaktni faqat Telegram ilovasida ulashish mumkin, brauzerda emas.',
    },
    session: {
      reopenTitle: 'Ilovani qaytadan oching',
      reopenText: 'Xavfsizlik uchun seans tugadi. LUMMI’ni yoping va bot chatidan qayta oching.',
    },
  },
);
export type MiniappMessages = (typeof miniappMessages)['ru'];

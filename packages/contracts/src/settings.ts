import { z } from 'zod';
import type { Bilingual } from './catalog';
import { telegramUsernameSchema } from './telegram-username';
import { thresholdBaseSchema, type UpgradeRightSource } from './quote';
import { PAYMENT_LINK_REASON_MAX } from './order-transition-payloads';
import { RECEIPT_UPLOAD_MAX_MB } from './receipt-upload';
import { RECEIPT_REJECT_NOTE_HARD_MAX } from './receipt-review';

/** The longest `receipts.botChoiceSeconds` may be: a day. The sweep that deletes pending files keeps them longer. */
export const BOT_CHOICE_MAX_SECONDS = 86_400;

/** Page sections of the settings screen, in display order. Their labels live in the admin messages. */
export const SETTING_AREAS = [
  'shop',
  'pricing',
  'search',
  'auth',
  'ai',
  'messaging',
  'worker',
  'system',
] as const;
export type SettingArea = (typeof SETTING_AREAS)[number];

/** What a number means; the label is in the admin messages (`settings.units`). */
export const SETTING_UNITS = [
  'none',
  'seconds',
  'days',
  'ms',
  'sum',
  'ml',
  'mb',
  'count',
  'ratio',
  'perSecond',
] as const;
export type SettingUnit = (typeof SETTING_UNITS)[number];

/**
 * What the settings page needs besides the schema: where it goes, what to call it, what it
 * measures. Object settings label their parts by dotted path (`upgradeRight.set`); enum values
 * get readable names through `optionLabels`. Anything left out falls back to the raw key.
 */
export interface SettingMeta {
  area: SettingArea;
  label: Bilingual;
  hint?: Bilingual;
  unit?: SettingUnit;
  fields?: Record<string, Bilingual>;
  optionLabels?: Record<string, Bilingual>;
  /** Leave the «Допустимо: …» line out where the hint already says what fits (a group id). */
  hideBounds?: boolean;
}

export interface SettingDefinition extends SettingMeta {
  schema: z.ZodTypeAny;
  default: unknown;
}

/**
 * Every rule value is a setting (CLAUDE.md invariant). Add a key here with its zod schema,
 * default and metadata; services read it through SettingsService, and the owner edits it on the
 * admin Settings page, which is generated from this registry (no UI work per setting). Changes go
 * through SettingsService.set, which writes the audit entry.
 */
export const settingDefinitions = {
  // ---- Shop
  /** Target of every «Написать менеджеру» in the Mini App (CLAUDE.md: Orders group manager account). */
  'shop.managerUsername': {
    schema: telegramUsernameSchema,
    default: '@lummi_manager',
    area: 'shop',
    label: { ru: 'Аккаунт менеджера в Telegram', uz: 'Menejerning Telegram akkaunti' },
    hint: {
      ru: 'Куда ведёт кнопка «Написать менеджеру» в приложении. С @, например @lummi_manager.',
      uz: 'Ilovadagi «Menejerga yozish» tugmasi shu akkauntga olib boradi. @ bilan, masalan @lummi_manager.',
    },
  },
  // Catalog lists (spec Changes 2026-11-10, #15)
  /** «Популярное» ranks by paid orders over this many days (owner-pinned hits stay first). */
  'catalog.topSalesWindowDays': {
    schema: z.number().int().min(1).max(365),
    default: 30,
    area: 'shop',
    unit: 'none',
    label: { ru: 'Окно «Популярного», дней', uz: '«Mashhur» oynasi, kunlar' },
    hint: {
      ru: 'Сколько последних дней считаются оплаченные заказы для топа продаж.',
      uz: 'Sotuvlar reytingi uchun soʻnggi necha kunlik toʻlangan buyurtmalar hisoblanadi.',
    },
  },
  /** The most fragrances «Похожие ароматы» shows on a card. */
  'catalog.similarCount': {
    schema: z.number().int().min(1).max(12),
    default: 6,
    area: 'shop',
    unit: 'count',
    label: { ru: 'Похожих ароматов на карточке', uz: 'Kartadagi oʻxshash iforlar soni' },
    hint: {
      ru: 'Сначала подобранные вручную, затем из того же семейства и типа, только в наличии.',
      uz: 'Avval qoʻlda tanlanganlar, keyin xuddi shu oila va turdagilar, faqat mavjudlari.',
    },
  },
  // Excel catalog import (spec Changes 2026-11-07, #26)
  /** The largest `LUMMI_Katalog.xlsx` the import accepts. */
  'catalog.import.maxBytes': {
    schema: z.number().int().min(100_000).max(20_000_000),
    default: 5_000_000,
    area: 'shop',
    unit: 'none',
    label: { ru: 'Импорт каталога: размер файла, байт', uz: 'Katalog importi: fayl hajmi, bayt' },
    hint: {
      ru: 'Файл Excel больше этого размера отклоняется до разбора.',
      uz: 'Shundan katta Excel fayl oʻqilmasdan rad etiladi.',
    },
  },
  /** The most data rows on each sheet of the import file. */
  'catalog.import.maxRows': {
    schema: z.number().int().min(10).max(20_000),
    default: 2_000,
    area: 'shop',
    unit: 'count',
    label: { ru: 'Импорт каталога: строк на листе', uz: 'Katalog importi: varaqdagi qatorlar' },
    hint: {
      ru: 'Лист с большим числом строк отклоняется целиком.',
      uz: 'Qatorlari bundan koʻp varaq butunlay rad etiladi.',
    },
  },
  // ---- Pricing
  /** Delivery is free once the threshold base reaches this many so'm (TZ §8). */
  'pricing.freeDeliveryThreshold': {
    schema: z.number().int().min(0).max(100_000_000),
    default: 250_000,
    area: 'pricing',
    unit: 'sum',
    label: { ru: 'Порог бесплатной доставки', uz: 'Bepul yetkazib berish chegarasi' },
    hint: {
      ru: 'С этой суммы товаров доставка бесплатна.',
      uz: 'Tovarlar shu summadan boshlab yetkazib berish bepul.',
    },
  },
  /** The delivery fee before the free-delivery threshold when the customer has no delivery city; a region's own tariff wins (spec Changes 2026-11-10). */
  'delivery.defaultTariff': {
    schema: z.number().int().min(0).max(100_000_000),
    default: 25_000,
    area: 'pricing',
    unit: 'sum',
    label: { ru: 'Стоимость доставки по умолчанию', uz: 'Odatiy yetkazib berish narxi' },
    hint: {
      ru: 'Пока клиент не выбрал город. Если у региона свой тариф, действует он.',
      uz: 'Mijoz shaharni tanlamaguncha. Viloyatning oʻz tarifi boʻlsa, oʻsha amal qiladi.',
    },
  },
  /** How many recipient + point pairs «Мои пункты BTS» keeps per customer; the least recently used goes first (spec Changes 2026-11-11). */
  'delivery.savedPointsMax': {
    schema: z.number().int().min(1).max(50),
    default: 5,
    area: 'shop',
    unit: 'count',
    label: { ru: 'Сколько пунктов BTS запоминать', uz: 'Nechta BTS punkti eslab qolinadi' },
    hint: {
      ru: 'Пары «получатель + пункт» из заказов покупателя, в «Моих пунктах BTS». Сверх лимита забываем давно не использованные.',
      uz: 'Xaridor buyurtmalaridagi «qabul qiluvchi + punkt» juftliklari, «Mening BTS punktlarim»da. Limitdan oshganda eng uzoq ishlatilmagani unutiladi.',
    },
  },
  /**
   * How long a new order's reserve lives without a receipt (TZ §4: 12 h, ADR 0012); the order
   * stores the instant as `reserve_until`. The metadata (area, label, unit, hint) is in the shape
   * of the admin settings page (#9).
   */
  'orders.reserveTtlSeconds': {
    schema: z
      .number()
      .int()
      .min(15 * 60)
      .max(7 * 86_400),
    default: 12 * 3600,
    area: 'shop',
    unit: 'seconds',
    label: { ru: 'Бронь товаров без чека', uz: 'Chek yuborilmaguncha mahsulotlar bandligi' },
    hint: {
      ru: 'Сколько заказ держит товары, пока не загружен чек. 43 200 секунд = 12 часов.',
      uz: 'Chek yuklanmaguncha buyurtma mahsulotlarni qancha vaqt band qilib turadi. 43 200 soniya = 12 soat.',
    },
  },
  /**
   * The reserve reminder goes this long before `reserve_until`, once, while the order still
   * waits for a receipt (spec Changes 2026-11-07, customer messages; #24).
   */
  'orders.reserveReminderSeconds': {
    schema: z
      .number()
      .int()
      .min(5 * 60)
      .max(7 * 86_400),
    default: 2 * 3600,
    area: 'shop',
    unit: 'seconds',
    label: { ru: 'Напоминание до конца брони', uz: 'Bandlik tugashidan oldin eslatma' },
    hint: {
      ru: 'За сколько до конца брони бот напомнит об оплате, если чек ещё не загружен. 7 200 секунд = 2 часа.',
      uz: 'Chek hali yuklanmagan boʻlsa, bot bandlik tugashidan qancha vaqt oldin toʻlov haqida eslatadi. 7 200 soniya = 2 soat.',
    },
  },
  /** The longest greeting card text of a gift order («Это подарок», spec Changes 2026-11-07). */
  'orders.giftMessageMaxLength': {
    schema: z.number().int().min(10).max(1000),
    default: 250,
    area: 'shop',
    unit: 'count',
    label: { ru: 'Длина текста открытки', uz: 'Otkritka matni uzunligi' },
    hint: {
      ru: 'Сколько символов покупатель может написать на открытке к подарку.',
      uz: 'Xaridor sovgʻa otkritkasiga nechta belgi yozishi mumkin.',
    },
  },
  /**
   * The countries a Recipient phone may be from, as calling codes without `+` (BTS hands parcels
   * over in Uzbekistan; spec Changes 2026-11-10 checkout, an open question).
   */
  'orders.recipientPhoneCountryCodes': {
    schema: z
      .array(z.string().regex(/^[1-9][0-9]{0,2}$/, 'a calling code: 1-3 digits'))
      .min(1)
      .max(20),
    default: ['998'] as string[],
    area: 'shop',
    unit: 'none',
    label: {
      ru: 'Страны номера получателя',
      uz: 'Qabul qiluvchi raqami mamlakatlari',
    },
    hint: {
      ru: 'Коды стран без «+», например 998 (Узбекистан). Номер получателя из другой страны не примем.',
      uz: 'Mamlakat kodlari «+»siz, masalan 998 (Oʻzbekiston). Boshqa mamlakat raqami qabul qilinmaydi.',
    },
  },
  /** The stock page marks a row «заканчивается» when its available is at or under this (spec Changes 2026-11-11). */
  'stock.lowAvailableThreshold': {
    schema: z.number().int().min(0).max(1000),
    default: 3,
    area: 'shop',
    unit: 'count',
    label: { ru: 'Порог «заканчивается» на складе', uz: 'Omborda «tugayapti» chegarasi' },
    hint: {
      ru: 'Строка склада подсвечивается, когда доступно не больше этого числа штук. Нуль подсвечивается всегда.',
      uz: 'Mavjud miqdor shu sondan oshmasa, ombor qatori ajratib koʻrsatiladi. Nol har doim ajratiladi.',
    },
  },
  /**
   * The largest Receipt a shopper may upload (TZ §4: «JPG, PNG, PDF, ≤ 10 MB»; ADR 0020), up to
   * the technical bound `RECEIPT_UPLOAD_MAX_MB`.
   */
  'receipts.maxUploadMb': {
    schema: z.number().int().min(1).max(RECEIPT_UPLOAD_MAX_MB),
    default: 10,
    area: 'shop',
    unit: 'mb',
    label: { ru: 'Размер файла чека', uz: 'Chek faylining hajmi' },
    hint: {
      ru: 'Самый большой скриншот или PDF чека, который примет приложение.',
      uz: 'Ilova qabul qiladigan eng katta chek skrinshoti yoki PDF fayli.',
    },
  },
  /** The longest note a manager may add when rejecting a receipt (#33, spec Changes 2026-11-11). */
  'receipts.rejectNoteMaxLength': {
    schema: z.number().int().min(20).max(RECEIPT_REJECT_NOTE_HARD_MAX),
    default: 300,
    area: 'shop',
    unit: 'count',
    label: { ru: 'Длина комментария к отклонённому чеку', uz: 'Rad etilgan chekka izoh uzunligi' },
    hint: {
      ru: 'Сколько символов менеджер может написать покупателю, когда не принимает чек.',
      uz: 'Chek qabul qilinmaganda menejer xaridorga nechta belgi yozishi mumkin.',
    },
  },
  /**
   * How long the bot keeps a receipt the shopper sent while several orders waited for payment,
   * until they choose the order with a button (#31). Later, the bot asks them to send it again.
   */
  'receipts.botChoiceSeconds': {
    schema: z.number().int().min(60).max(BOT_CHOICE_MAX_SECONDS),
    default: 3600,
    area: 'shop',
    unit: 'seconds',
    label: {
      ru: 'Сколько ждём выбор заказа для чека в боте',
      uz: 'Botda chek uchun buyurtma tanlovini kutish vaqti',
    },
    hint: {
      ru: 'Если у покупателя несколько заказов, бот спрашивает, к какому относится чек. Выбор после этого срока бот не примет и попросит отправить чек заново. 3 600 секунд = 1 час.',
      uz: 'Xaridorning bir nechta buyurtmasi boʻlsa, bot chek qaysi buyurtmaga tegishli ekanini soʻraydi. Bu muddatdan keyingi tanlovni bot qabul qilmaydi va chekni qayta yuborishni soʻraydi. 3 600 soniya = 1 soat.',
    },
  },
  /**
   * The longest reason staff may type when they link a credit that does not match its order
   * exactly: another amount (tiyin included) or another card (#32, #33), up to the technical
   * bound `PAYMENT_LINK_REASON_MAX`.
   */
  'payments.linkReasonMaxLength': {
    schema: z.number().int().min(20).max(PAYMENT_LINK_REASON_MAX),
    default: 500,
    area: 'shop',
    unit: 'count',
    label: {
      ru: 'Длина причины при ручной привязке платежа',
      uz: 'Toʻlovni qoʻlda bogʻlash sababining uzunligi',
    },
    hint: {
      ru: 'Сколько символов сотрудник может написать, привязывая к заказу поступление с другой суммой или на другую карту.',
      uz: 'Xodim buyurtmaga boshqa summadagi yoki boshqa kartaga tushgan toʻlovni bogʻlaganda yozishi mumkin boʻlgan belgilar soni.',
    },
  },
  /**
   * The wait window (ADR 0012, #36): a receipt with no fitting credit this long after it was sent
   * becomes «оплата не найдена», and its order goes back to «Ожидает оплаты» (cancelled if the
   * reserve has ended). The time the Humo feed was paused does not count.
   */
  'payments.notFoundAfterSeconds': {
    schema: z
      .number()
      .int()
      .min(10 * 60)
      .max(7 * 86_400),
    default: 2 * 3600,
    area: 'shop',
    unit: 'seconds',
    label: { ru: 'Сколько ждать перевод по чеку', uz: 'Chek boʻyicha oʻtkazmani qancha kutish' },
    hint: {
      ru: 'Если за это время на карту магазина не пришёл перевод на сумму заказа, покупатель получит «оплата не найдена» и сможет загрузить чек заново. Пока лента Humo не работает, время не идёт. 7 200 секунд = 2 часа.',
      uz: 'Shu vaqt ichida doʻkon kartasiga buyurtma summasidagi oʻtkazma kelmasa, xaridor «toʻlov topilmadi» xabarini oladi va chekni qayta yuklay oladi. Humo lentasi ishlamayotganda vaqt hisoblanmaydi. 7 200 soniya = 2 soat.',
    },
  },
  /** How many 10 ml suggestions the cart's free-delivery thread offers (spec Changes 2026-11-10). */
  'cart.suggestionsLimit': {
    schema: z.number().int().min(0).max(12),
    default: 3,
    area: 'shop',
    label: {
      ru: 'Сколько ароматов 10 мл предлагать в корзине',
      uz: 'Savatda nechta 10 ml atir taklif qilinadi',
    },
    hint: {
      ru: 'Подсказки под полосой бесплатной доставки. 0 — не показывать.',
      uz: 'Bepul yetkazib berish chizigʻi ostidagi takliflar. 0 — koʻrsatilmaydi.',
    },
  },
  /** Per discount source: is the threshold compared with items before or after the discount (spec Changes 2026-11-07). */
  'pricing.thresholdBase': {
    schema: z.object({
      upgradeRight: z.object({
        set: thresholdBaseSchema,
        single_10ml: thresholdBaseSchema,
      } satisfies Record<UpgradeRightSource, typeof thresholdBaseSchema>),
      promoCode: thresholdBaseSchema,
      birthdayCoupon: thresholdBaseSchema,
    }),
    default: {
      upgradeRight: { set: 'before', single_10ml: 'before' },
      promoCode: 'after',
      birthdayCoupon: 'after',
    } as const,
    area: 'pricing',
    label: {
      ru: 'С какой суммы считать порог бесплатной доставки',
      uz: 'Bepul yetkazib berish chegarasi qaysi summadan hisoblanadi',
    },
    hint: {
      ru: 'Для каждой скидки: сумма товаров до скидки или после неё.',
      uz: 'Har bir chegirma uchun: tovarlar summasi chegirmadan oldin yoki keyin.',
    },
    fields: {
      upgradeRight: { ru: 'Право на апгрейд', uz: 'Yangilash huquqi' },
      'upgradeRight.set': { ru: 'Из набора', uz: 'Naboridan' },
      'upgradeRight.single_10ml': { ru: 'Из флакона 10 мл', uz: '10 ml flakondan' },
      promoCode: { ru: 'Промокод', uz: 'Promokod' },
      birthdayCoupon: { ru: 'Купон ко дню рождения', uz: 'Tugʻilgan kun kuponi' },
    },
    optionLabels: {
      before: { ru: 'До скидки', uz: 'Chegirmadan oldin' },
      after: { ru: 'После скидки', uz: 'Chegirmadan keyin' },
    },
  },
  /** Whether upgrade rights and birthday coupons also discount marked-down items; promo codes carry their own flag (ADR 0008). */
  'pricing.discountsApplyToMarkedDown': {
    schema: z.object({ upgradeRight: z.boolean(), birthdayCoupon: z.boolean() }),
    default: { upgradeRight: false, birthdayCoupon: false },
    area: 'pricing',
    label: {
      ru: 'Скидка на товары с уценкой',
      uz: 'Narxi tushirilgan tovarlarga chegirma',
    },
    hint: {
      ru: 'Распространяется ли скидка на уже уценённые товары. У промокода своя настройка.',
      uz: 'Chegirma allaqachon arzonlashtirilgan tovarlarga ham amal qiladimi. Promokodning oʻz sozlamasi bor.',
    },
    fields: {
      upgradeRight: { ru: 'Право на апгрейд', uz: 'Yangilash huquqi' },
      birthdayCoupon: { ru: 'Купон ко дню рождения', uz: 'Tugʻilgan kun kuponi' },
    },
  },
  /** The volumes an upgrade right can discount: Full size (TZ §3.4 «Полный объём»); never 10 ml. */
  'pricing.fullSizeVolumesMl': {
    schema: z.array(z.number().int().gt(10, 'Full size is above 10 ml')).min(1),
    default: [30, 50] as number[],
    area: 'pricing',
    unit: 'ml',
    label: { ru: 'Полные объёмы для апгрейда', uz: 'Yangilash uchun toʻliq hajmlar' },
    hint: {
      ru: 'Объёмы, на которые действует право на апгрейд. Только больше 10 мл, через запятую.',
      uz: 'Yangilash huquqi amal qiladigan hajmlar. Faqat 10 ml dan katta, vergul bilan.',
    },
  },
  /** Orders take the last campaign link opened within this many days before ordering (#35, ADR 0022). */
  'campaigns.attributionWindowDays': {
    schema: z.number().int().min(1).max(365),
    default: 7,
    area: 'shop',
    unit: 'days',
    label: { ru: 'Окно атрибуции ссылок', uz: 'Havolalarni hisobga olish oynasi' },
    hint: {
      ru: 'Заказ получает источник из последней рекламной ссылки, открытой за столько суток до заказа (сутки = ровно 24 часа).',
      uz: 'Buyurtma manbasi — buyurtmadan shuncha sutka oldin ochilgan oxirgi reklama havolasi (sutka = roppa-rosa 24 soat).',
    },
  },
  /** Promo codes are guessable: a customer may type this many per window (ticket #29). */
  'promo.attemptLimit': {
    schema: z.number().int().min(1).max(1000),
    default: 10,
    area: 'pricing',
    unit: 'count',
    label: { ru: 'Попыток ввести промокод', uz: 'Promokod kiritish urinishlari' },
    hint: {
      ru: 'Сколько кодов клиент может ввести за окно ниже. Защищает от подбора кодов.',
      uz: 'Mijoz quyidagi oyna ichida nechta kod kirita oladi. Kodlarni taxmin qilishdan himoya.',
    },
  },
  'promo.attemptWindowSeconds': {
    schema: z
      .number()
      .int()
      .min(60)
      .max(7 * 86_400),
    default: 3600,
    area: 'pricing',
    unit: 'seconds',
    label: { ru: 'Окно попыток ввода промокода', uz: 'Promokod urinishlari oynasi' },
    hint: {
      ru: 'После стольких попыток новый код можно ввести, когда окно закончится.',
      uz: 'Shuncha urinishdan keyin yangi kodni oyna tugagach kiritish mumkin.',
    },
  },
  // Birthday coupon (TZ §3.8, #30). Its threshold base and marked-down flag are the
  // `pricing.thresholdBase` and `pricing.discountsApplyToMarkedDown` entries above. Percent and
  // cap are fixed on each coupon when it is issued, as its bot message announced them.
  /** The coupon's discount on items, whole percent (TZ: 20%). */
  'birthday.percent': {
    schema: z.number().int().min(1).max(100),
    default: 20,
    area: 'pricing',
    unit: 'none',
    label: { ru: 'Купон ко дню рождения, %', uz: 'Tugʻilgan kun kuponi, %' },
    hint: {
      ru: 'Скидка на товары, без доставки. Новое значение действует для следующих купонов.',
      uz: 'Tovarlarga chegirma, yetkazib berishsiz. Yangi qiymat keyingi kuponlarga amal qiladi.',
    },
  },
  /** The most one coupon takes off (TZ: «Max скидка [amount]»; to confirm, open-questions). */
  'birthday.maxAmount': {
    schema: z.number().int().min(0).max(100_000_000),
    default: 100_000,
    area: 'pricing',
    unit: 'sum',
    label: {
      ru: 'Купон ко дню рождения: наибольшая скидка',
      uz: 'Tugʻilgan kun kuponi: eng katta chegirma',
    },
    hint: {
      ru: 'Больше этой суммы купон не скидывает, сколько бы ни стоили товары.',
      uz: 'Tovarlar qancha boʻlmasin, kupon bundan koʻp chegirma bermaydi.',
    },
  },
  /** The coupon arrives this many days before the birthday, at 10:00 Tashkent (TZ: 3). */
  'birthday.daysBefore': {
    schema: z.number().int().min(0).max(30),
    default: 3,
    area: 'pricing',
    unit: 'none',
    label: {
      ru: 'Купон ко дню рождения: дней до праздника',
      uz: 'Tugʻilgan kun kuponi: bayramgacha kunlar',
    },
    hint: {
      ru: 'Купон приходит в час отправки по Ташкенту за столько дней до дня рождения и сразу действует.',
      uz: 'Kupon tugʻilgan kundan shuncha kun oldin Toshkent vaqti bilan yuborish soatida keladi va darhol amal qiladi.',
    },
  },
  /**
   * The Tashkent hour the coupon arrives (TZ §3.8: «в 10:00 по Ташкенту», changed in the admin). The
   * job runs every hour and issues once this hour has come on the first day.
   */
  'birthday.issueHour': {
    schema: z.number().int().min(0).max(23),
    default: 10,
    area: 'pricing',
    unit: 'none',
    label: {
      ru: 'Купон ко дню рождения: час отправки',
      uz: 'Tugʻilgan kun kuponi: yuborish soati',
    },
    hint: {
      ru: 'По Ташкенту, от 0 до 23: купон приходит в начале этого часа.',
      uz: 'Toshkent vaqti bilan, 0 dan 23 gacha: kupon shu soat boshida keladi.',
    },
  },
  /** The coupon works through the end of this many days after the birthday (TZ: 7). */
  'birthday.daysAfter': {
    schema: z.number().int().min(0).max(30),
    default: 7,
    area: 'pricing',
    unit: 'none',
    label: {
      ru: 'Купон ко дню рождения: дней после праздника',
      uz: 'Tugʻilgan kun kuponi: bayramdan keyingi kunlar',
    },
    hint: {
      ru: 'Купон действует до конца этого дня после дня рождения. Новое значение действует для следующих купонов.',
      uz: 'Kupon tugʻilgan kundan keyingi shu kun oxirigacha amal qiladi. Yangi qiymat keyingi kuponlarga amal qiladi.',
    },
  },
  /** Abuse guard (TZ §3.8): the first coupon opens no sooner than this many days after the date was entered. */
  'birthday.firstCouponAfterDays': {
    schema: z.number().int().min(0).max(365),
    default: 14,
    area: 'pricing',
    unit: 'none',
    label: {
      ru: 'Первый купон ко дню рождения не раньше чем через, дней',
      uz: 'Birinchi tugʻilgan kun kuponi kamida necha kundan keyin, kun',
    },
    hint: {
      ru: 'Защита от злоупотреблений: считается от дня, когда покупатель указал дату рождения.',
      uz: 'Suiisteʼmoldan himoya: xaridor tugʻilgan sanasini kiritgan kundan hisoblanadi.',
    },
  },
  // ---- Bot and orders group
  // Orders group (spec Changes 2026-11-07). Null until the group is set up; the bot follows migrate_to_chat_id.
  'bot.groupChatId': {
    /** Telegram supergroup ids are negative (-100…). */
    schema: z.number().int().max(-1).nullable(),
    default: null,
    area: 'system',
    label: { ru: 'ID группы заказов', uz: 'Buyurtmalar guruhining ID raqami' },
    // The bot does not take the id when it is added to a group (it only follows a group that
    // becomes a supergroup), so the hint asks for it by hand.
    hint: {
      ru: 'Пусто, пока группа не подключена. Введите ID вручную: отрицательное число вида -1001234567890. Если группа станет супергруппой, бот обновит ID сам.',
      uz: 'Guruh ulanmaguncha boʻsh. ID ni qoʻlda kiriting: -1001234567890 kabi manfiy son. Guruh supergruppaga aylansa, bot ID ni oʻzi yangilaydi.',
    },
    hideBounds: true,
  },
  'bot.topics': {
    schema: z.object({
      orders: z.number().int().positive().nullable(),
      payments: z.number().int().positive().nullable(),
      reviews: z.number().int().positive().nullable(),
      system: z.number().int().positive().nullable(),
    }),
    default: { orders: null, payments: null, reviews: null, system: null },
    area: 'system',
    label: { ru: 'Темы группы заказов', uz: 'Buyurtmalar guruhi mavzulari' },
    hint: {
      ru: 'ID тем группы. Пусто, пока тема не создана.',
      uz: 'Guruh mavzularining ID raqamlari. Mavzu yaratilmaguncha boʻsh.',
    },
    fields: {
      orders: { ru: 'Заказы', uz: 'Buyurtmalar' },
      payments: { ru: 'Оплаты', uz: 'Toʻlovlar' },
      reviews: { ru: 'Отзывы', uz: 'Sharhlar' },
      system: { ru: 'Системные', uz: 'Tizim' },
    },
  },
  /**
   * The payment feed is down when the userbot's last heartbeat (it beats every minute) is older
   * than this: receipt timers pause and the owner is alerted once (ADR 0012, #36).
   */
  'payments.heartbeatStaleSeconds': {
    schema: z.number().int().min(120).max(3600),
    default: 300,
    area: 'system',
    unit: 'seconds',
    label: { ru: 'Юзербот молчит дольше', uz: 'Userbot jim turgan vaqt' },
    hint: {
      ru: 'Юзербот выходит на связь каждую минуту. Если его нет дольше этого срока, таймеры чеков встают на паузу и владелец получает предупреждение. Держите меньше времени ожидания перевода по чеку.',
      uz: 'Userbot har daqiqada aloqaga chiqadi. Bundan uzoqroq aloqa boʻlmasa, cheklar taymerlari pauzaga qoʻyiladi va egasi ogohlantiriladi. Chek boʻyicha oʻtkazmani kutish vaqtidan kamroq qiling.',
    },
  },
  /**
   * Humo is silent when no credit has arrived for this long while receipts wait (TZ §4 «Humo
   * молчит > 30 мин»): receipt timers pause and the owner is alerted once (ADR 0012, #36).
   */
  'payments.humoSilenceSeconds': {
    schema: z
      .number()
      .int()
      .min(5 * 60)
      .max(86_400),
    default: 30 * 60,
    area: 'system',
    unit: 'seconds',
    label: { ru: 'Humo молчит дольше', uz: 'Humo jim turgan vaqt' },
    hint: {
      ru: 'Если чеки ждут, а поступлений от Humo нет дольше этого срока, таймеры чеков встают на паузу и владелец получает предупреждение. Держите меньше времени ожидания перевода по чеку, иначе сбой Humo может отменить оплаченный заказ. 1 800 секунд = 30 минут.',
      uz: 'Cheklar kutib turgan, lekin Humo tushumlari bundan uzoqroq kelmasa, cheklar taymerlari pauzaga qoʻyiladi va egasi ogohlantiriladi. Chek boʻyicha oʻtkazmani kutish vaqtidan kamroq qiling, aks holda Humo nosozligi toʻlangan buyurtmani bekor qilishi mumkin. 1 800 soniya = 30 daqiqa.',
    },
  },
  /**
   * A receipt waiting (for its credit or for a person) longer than this alerts the owner, once per
   * receipt (TZ §6 «Чек не проверен > 15 мин», #36).
   */
  'payments.uncheckedReceiptAlertSeconds': {
    schema: z
      .number()
      .int()
      .min(60)
      .max(7 * 86_400),
    default: 15 * 60,
    area: 'system',
    unit: 'seconds',
    label: {
      ru: 'Предупреждать о непроверенном чеке через',
      uz: 'Tekshirilmagan chek haqida ogohlantirish',
    },
    hint: {
      ru: 'Если чек ждёт поступления или решения менеджера дольше этого срока, владелец получит одно предупреждение об этом чеке. 900 секунд = 15 минут.',
      uz: 'Chek tushumni yoki menejer qarorini bundan uzoqroq kutsa, egasi shu chek haqida bitta ogohlantirish oladi. 900 soniya = 15 daqiqa.',
    },
  },
  /** Telegram ids (owner, developer) who get alerts in DM as well as in the Системные topic. */
  'bot.alertRecipients': {
    schema: z.array(z.number().int().positive()),
    default: [] as number[],
    area: 'system',
    label: {
      ru: 'Кому присылать предупреждения в личные сообщения',
      uz: 'Ogohlantirishlar kimga shaxsiy xabarda yuborilsin',
    },
    hint: {
      ru: 'Telegram ID через запятую. Предупреждения приходят им в личные сообщения и в тему «Системные».',
      uz: 'Telegram ID raqamlari vergul bilan. Ogohlantirishlar ularga shaxsiy xabarda va «Tizim» mavzusida keladi.',
    },
  },
  // ---- Sign-in and sessions
  'auth.initDataMaxAgeSeconds': {
    schema: z.number().int().min(10).max(86_400),
    default: 300,
    area: 'auth',
    unit: 'seconds',
    label: { ru: 'Свежесть входа в приложение', uz: 'Ilovaga kirishning yangiligi' },
    hint: {
      ru: 'Подпись Telegram старше этого срока не принимается.',
      uz: 'Telegram imzosi bu muddatdan eski boʻlsa, qabul qilinmaydi.',
    },
  },
  'auth.initDataMaxFutureSkewSeconds': {
    schema: z.number().int().min(0).max(300),
    default: 30,
    area: 'auth',
    unit: 'seconds',
    label: {
      ru: 'Допуск расхождения часов при входе в приложение',
      uz: 'Ilovaga kirishda soat farqiga ruxsat',
    },
  },
  'auth.sessionTtlSeconds': {
    schema: z
      .number()
      .int()
      .min(60)
      .max(7 * 86_400),
    default: 3600,
    area: 'auth',
    unit: 'seconds',
    label: { ru: 'Срок сессии клиента', uz: 'Mijoz seansi muddati' },
  },
  'auth.loginWidgetMaxAgeSeconds': {
    schema: z.number().int().min(10).max(86_400),
    default: 300,
    area: 'auth',
    unit: 'seconds',
    label: { ru: 'Свежесть входа в панель', uz: 'Panelga kirishning yangiligi' },
  },
  'auth.loginWidgetMaxFutureSkewSeconds': {
    schema: z.number().int().min(0).max(300),
    default: 30,
    area: 'auth',
    unit: 'seconds',
    label: {
      ru: 'Допуск расхождения часов при входе в панель',
      uz: 'Panelga kirishda soat farqiga ruxsat',
    },
  },
  'auth.staffSessionTtlSeconds': {
    schema: z
      .number()
      .int()
      .min(300)
      .max(30 * 86_400),
    default: 7 * 86_400,
    area: 'auth',
    unit: 'seconds',
    label: { ru: 'Срок сессии сотрудника', uz: 'Xodim seansi muddati' },
  },
  // ---- Receipt AI (ADR 0013). Defaults tuned later on 20-30 real receipts with the eval script.
  /** Every predicate (is a receipt, amount, recipient) must reach this probability to confirm. */
  'ai.receipt.probabilityThreshold': {
    schema: z.number().min(0).max(1),
    default: 0.8,
    area: 'ai',
    unit: 'ratio',
    label: { ru: 'Порог уверенности ИИ по чеку', uz: 'Chek boʻyicha AI ishonch chegarasi' },
    hint: {
      ru: 'От 0 до 1. Каждая проверка (это чек, сумма, получатель) должна дойти до порога.',
      uz: '0 dan 1 gacha. Har bir tekshiruv (bu chek, summa, qabul qiluvchi) chegaraga yetishi kerak.',
    },
  },
  /** The receipt's date-time choice must reach this confidence (and not be "none of these"). */
  'ai.receipt.confidenceThreshold': {
    schema: z.number().min(0).max(1),
    default: 0.6,
    area: 'ai',
    unit: 'ratio',
    label: { ru: 'Порог выбора времени на чеке', uz: 'Chekdagi vaqtni tanlash chegarasi' },
    hint: {
      ru: 'От 0 до 1. Насколько ИИ должен быть уверен в выбранном времени.',
      uz: '0 dan 1 gacha. AI tanlangan vaqtga qanchalik ishonishi kerak.',
    },
  },
  /**
   * A receipt is a repeat of another order's when its image's 64-bit perceptual hash (#28) differs
   * in at most this many bits (#36); null compares whole files (SHA-256) only. Off by default: the
   * hash is too coarse to tell two receipts of one bank app apart (spec Changes 2026-11-11, #36).
   */
  'receipts.duplicateImageDistance': {
    schema: z.number().int().min(0).max(16).nullable(),
    default: null,
    area: 'ai',
    unit: 'count',
    label: {
      ru: 'Повторный чек по похожему изображению',
      uz: 'Oʻxshash rasm boʻyicha takroriy chek',
    },
    hint: {
      ru: 'Пусто — повторным считается только тот же файл. Число от 0 до 16 — ещё и картинка, отличающаяся от чека другого заказа не больше чем на столько бит из 64. Включение в течение минуты проверит и чеки, которые уже ждут. Осторожно: чеки одного банковского приложения похожи между собой, и честный чек может уйти в «оплата не найдена».',
      uz: 'Boʻsh — faqat aynan oʻsha fayl takroriy hisoblanadi. 0 dan 16 gacha son — boshqa buyurtma chekidan 64 bitdan koʻpi bilan shuncha bitga farq qiladigan rasm ham. Yoqilgach, bir daqiqa ichida kutayotgan cheklar ham tekshiriladi. Ehtiyot boʻling: bitta bank ilovasining cheklari bir-biriga oʻxshaydi va halol chek «toʻlov topilmadi»ga tushishi mumkin.',
    },
  },
  /** Per-call timeouts; on expiry TypeSafe falls back to OpenAI, OpenAI means "failed". */
  'ai.receipt.typesafeTimeoutMs': {
    schema: z.number().int().min(1000).max(120_000),
    default: 20_000,
    area: 'ai',
    unit: 'ms',
    label: {
      ru: 'Сколько ждать основную проверку чека',
      uz: 'Asosiy tekshiruvni qancha kutish',
    },
    hint: {
      ru: 'По истечении чек передаётся запасной проверке.',
      uz: 'Vaqt tugasa, chek zaxira tekshiruvga oʻtadi.',
    },
  },
  'ai.receipt.openaiTimeoutMs': {
    schema: z.number().int().min(1000).max(120_000),
    default: 30_000,
    area: 'ai',
    unit: 'ms',
    label: { ru: 'Сколько ждать запасную проверку', uz: 'Zaxira tekshiruvni qancha kutish' },
    hint: {
      ru: 'По истечении проверка считается неудавшейся.',
      uz: 'Vaqt tugasa, tekshiruv muvaffaqiyatsiz hisoblanadi.',
    },
  },
  // ---- Search (ADR 0019)
  /** Ranking weights of the trigram score: name and aliases, original brand, notes, family. */
  'search.weights': {
    schema: z.object({
      name: z.number().min(0).max(100),
      brand: z.number().min(0).max(100),
      notes: z.number().min(0).max(100),
      family: z.number().min(0).max(100),
      /** Added to a fragrance whose card key notes contain the query word, within its tier. */
      keyNotes: z.number().min(0).max(100),
    }),
    default: { name: 3, brand: 1.5, notes: 1, family: 1, keyNotes: 10 },
    area: 'search',
    label: { ru: 'Вес совпадений в поиске', uz: 'Qidiruvda mosliklar vazni' },
    hint: {
      ru: 'От 0 до 100. Чем больше вес поля, тем выше аромат, совпавший в этом поле.',
      uz: '0 dan 100 gacha. Maydon vazni qancha katta boʻlsa, shu maydonda mos kelgan atir shuncha yuqorida.',
    },
    fields: {
      name: { ru: 'Название и псевдонимы', uz: 'Nomi va taxalluslar' },
      brand: { ru: 'Бренд', uz: 'Brend' },
      notes: { ru: 'Ноты', uz: 'Notalar' },
      family: { ru: 'Семейство', uz: 'Oila' },
      keyNotes: { ru: 'Три ключевые ноты', uz: 'Uchta asosiy nota' },
    },
  },
  /** A field only counts when its trigram word similarity with the query reaches this (0..1). */
  'search.minSimilarity': {
    schema: z.number().min(0).max(1),
    default: 0.3,
    area: 'search',
    unit: 'ratio',
    label: { ru: 'Порог похожести в поиске', uz: 'Qidiruvda oʻxshashlik chegarasi' },
    hint: {
      ru: 'От 0 до 1. Чем выше порог, тем меньше опечаток прощает поиск.',
      uz: '0 dan 1 gacha. Chegara qancha baland boʻlsa, qidiruv shuncha kam xatoni kechiradi.',
    },
  },
  /** Suggestions and results start at this many characters. */
  'search.minQueryLength': {
    schema: z.number().int().min(1).max(10),
    default: 2,
    area: 'search',
    label: { ru: 'С какой буквы искать', uz: 'Nechanchi harfdan qidiriladi' },
    hint: {
      ru: 'Подсказки и результаты появляются, когда введено столько букв.',
      uz: 'Shuncha harf kiritilganda takliflar va natijalar chiqadi.',
    },
  },
  'search.suggestLimit': {
    schema: z.number().int().min(1).max(20),
    default: 5,
    area: 'search',
    label: { ru: 'Сколько подсказок показывать', uz: 'Nechta taklif koʻrsatiladi' },
    hint: {
      ru: 'Подсказки под полем поиска, пока клиент печатает.',
      uz: 'Mijoz yozayotganda qidiruv maydoni ostidagi takliflar.',
    },
  },
  'search.resultsLimit': {
    schema: z.number().int().min(1).max(100),
    default: 30,
    area: 'search',
    label: { ru: 'Сколько результатов показывать', uz: 'Nechta natija koʻrsatiladi' },
    hint: {
      ru: 'Карточки ароматов, когда клиент отправил запрос.',
      uz: 'Mijoz soʻrovni yuborganda chiqadigan atir kartochkalari.',
    },
  },
  // ---- Background jobs
  /** A queued outbox row that was not sent within this window is handed to the queue again. */
  'outbox.requeueAfterSeconds': {
    schema: z.number().int().min(30).max(86_400),
    default: 300,
    area: 'worker',
    unit: 'seconds',
    label: {
      ru: 'Повторная отправка сообщений из очереди',
      uz: 'Navbatdagi xabarlarni qayta yuborish',
    },
    hint: {
      ru: 'Сообщение, не ушедшее за это время, ставится в очередь снова.',
      uz: 'Shu vaqt ichida ketmagan xabar navbatga qayta qoʻyiladi.',
    },
  },
  /** After this many consecutive failed ticks a sweep alerts the owner once (not every minute). */
  'worker.sweepFailureAlertAfter': {
    schema: z.number().int().min(1).max(1000),
    default: 3,
    area: 'worker',
    unit: 'count',
    label: { ru: 'Сбоев подряд до предупреждения', uz: 'Ogohlantirishgacha ketma-ket nosozliklar' },
    hint: {
      ru: 'Фоновая проверка предупредит владельца один раз после стольких неудач подряд.',
      uz: 'Fon tekshiruvi shuncha ketma-ket muvaffaqiyatsizlikdan keyin egasini bir marta ogohlantiradi.',
    },
  },
  /** Minutes without a worker tick before the API alerts (ADR 0034). */
  'ops.workerSilentMinutes': {
    schema: z.number().int().min(2).max(60),
    default: 3,
    area: 'worker',
    unit: 'count',
    label: {
      ru: 'Минут тишины фонового сервиса до тревоги',
      uz: 'Fon xizmati jim turganda ogohlantirish (daqiqa)',
    },
    hint: {
      ru: 'Фоновый сервис отмечается каждую минуту. Если его нет дольше этого срока, владелец и разработчик получают сообщение один раз, и ещё одно, когда сервис вернётся.',
      uz: 'Fon xizmati har daqiqada belgi qoldiradi. Bundan uzoq jim tursa, egasi va dasturchi bir marta xabar oladi, xizmat qaytganda yana bir marta.',
    },
  },
  /** Developer's Telegram chat id: gets the first occurrence of every new error (ADR 0034). Null = nobody. */
  'ops.developerChatId': {
    schema: z
      .number()
      .int()
      .refine((n) => n !== 0)
      .nullable(),
    default: null,
    area: 'system',
    label: { ru: 'Telegram ID разработчика', uz: 'Dasturchining Telegram ID raqami' },
    hint: {
      ru: 'Сюда приходит сообщение о каждой новой ошибке сервера (без персональных данных) и тревога, если фоновый сервис замолчал. Пусто, пока не задан.',
      uz: 'Serverning har bir yangi xatosi (shaxsiy maʼlumotlarsiz) va fon xizmati jim qolgani haqidagi ogohlantirish shu yerga keladi. Belgilanmaguncha boʻsh.',
    },
    hideBounds: true,
  },
  // ---- Messaging
  /** Broadcast sends per second. Telegram allows about 30 per second to different chats, so 25 is the ceiling (ADR 0021). Read when the worker starts. */
  'broadcast.sendRatePerSecond': {
    schema: z.number().int().min(1).max(25),
    default: 25,
    area: 'messaging',
    unit: 'perSecond',
    label: { ru: 'Скорость рассылки', uz: 'Xabar yuborish tezligi' },
    hint: {
      ru: 'Сколько сообщений в секунду уходит клиентам при рассылке. Telegram не принимает больше 30, поэтому предел 25. Применяется после перезапуска сервиса.',
      uz: 'Ommaviy xabarda mijozlarga soniyasiga nechta xabar ketadi. Telegram 30 tadan ortiq qabul qilmaydi, shuning uchun chegara 25. Xizmat qayta ishga tushirilgach qoʻllanadi.',
    },
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingDefinitions)[K]['schema']>;
export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];

/** One registry entry typed for generic code (the admin page, `displayValue`): schema, default and metadata. */
export function settingMeta(key: SettingKey): SettingDefinition {
  return settingDefinitions[key] as SettingDefinition;
}

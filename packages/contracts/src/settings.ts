import { z } from 'zod';
import type { Bilingual } from './catalog';
import { telegramUsernameSchema } from './telegram-username';
import { thresholdBaseSchema, type UpgradeRightSource } from './quote';

/** Page sections of the settings screen, in display order. Their labels live in the admin messages. */
export const SETTING_AREAS = [
  'shop',
  'pricing',
  'search',
  'auth',
  'ai',
  'worker',
  'system',
] as const;
export type SettingArea = (typeof SETTING_AREAS)[number];

/** What a number means; the label is in the admin messages (`settings.units`). */
export const SETTING_UNITS = ['none', 'seconds', 'ms', 'sum', 'ml', 'count', 'ratio'] as const;
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
  // ---- Bot and orders group
  // Orders group (spec Changes 2026-11-07). Null until the group is set up; the bot follows migrate_to_chat_id.
  'bot.groupChatId': {
    /** Telegram supergroup ids are negative (-100…). */
    schema: z.number().int().max(-1).nullable(),
    default: null,
    area: 'system',
    label: { ru: 'ID группы заказов', uz: 'Buyurtmalar guruhining ID raqami' },
    hint: {
      ru: 'Пусто, пока группа не подключена. Бот обновляет значение сам, если группа переехала.',
      uz: 'Guruh ulanmaguncha boʻsh. Guruh koʻchsa, bot qiymatni oʻzi yangilaydi.',
    },
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
  /** Telegram ids (owner, developer) who get alerts in DM as well as in the Системные topic. */
  'bot.alertRecipients': {
    schema: z.array(z.number().int().positive()),
    default: [] as number[],
    area: 'system',
    label: { ru: 'Кому слать алерты в личные', uz: 'Ogohlantirishlar kimga shaxsiy yuboriladi' },
    hint: {
      ru: 'Telegram ID через запятую. Алерты приходят им в личные сообщения и в тему «Системные».',
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
  /** Per-call timeouts; on expiry TypeSafe falls back to OpenAI, OpenAI means "failed". */
  'ai.receipt.typesafeTimeoutMs': {
    schema: z.number().int().min(1000).max(120_000),
    default: 20_000,
    area: 'ai',
    unit: 'ms',
    label: { ru: 'Тайм-аут TypeSafe', uz: 'TypeSafe kutish vaqti' },
    hint: {
      ru: 'По истечении проверку берёт OpenAI.',
      uz: 'Vaqt tugasa, tekshiruvni OpenAI oladi.',
    },
  },
  'ai.receipt.openaiTimeoutMs': {
    schema: z.number().int().min(1000).max(120_000),
    default: 30_000,
    area: 'ai',
    unit: 'ms',
    label: { ru: 'Тайм-аут OpenAI', uz: 'OpenAI kutish vaqti' },
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
    label: { ru: 'Сбоев подряд до алерта', uz: 'Ogohlantirishgacha ketma-ket xatolar' },
    hint: {
      ru: 'Фоновая проверка предупредит владельца один раз после стольких неудач подряд.',
      uz: 'Fon tekshiruvi shuncha ketma-ket muvaffaqiyatsizlikdan keyin egasini bir marta ogohlantiradi.',
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

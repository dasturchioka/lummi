import { contentTexts, infoPages, type Db } from '@lummi/db';
import { normalizeUzbek } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import type { InfoPageSlug } from '@lummi/contracts';
import { SLOGAN_KEY } from './content.service';

/**
 * Draft texts from the TZ appendix (v1.11), seeded as drafts pending the customer's approval
 * (ticket #21). Changes from the TZ draft, all for the brand's copy rules (CLAUDE.md): the FAQ's
 * first question no longer uses the banned word «оригинал» (it asks about the known brands'
 * fragrances instead), and longevity reads «до 24 часов» / «24 soatgacha» as the customer decided
 * on 2026-11-07, not the draft's «[8–12]». Delivery follows the 2026-11-06 decision (BTS to a
 * pickup point, a tariff per region, free from a threshold, «до 48 часов после передачи в BTS»).
 * Numbers, the payment window and the manager's handle are `{placeholders}` the API fills from
 * the settings when a customer reads the page
 * (`CONTENT_PLACEHOLDERS`), so a text can't drift from the admin. The returns window «[3] дней»
 * keeps its number but is still to be confirmed (open-questions). The public offer is a
 * placeholder: it comes from the customer's lawyer.
 *
 * The slogan's default is the Mini App's own built-in string (`home.slogan`), one source.
 */
export const SLOGAN_SEED = {
  ru: miniappMessages.ru.home.slogan,
  uz: miniappMessages.uz.home.slogan,
};

interface PageSeed {
  slug: InfoPageSlug;
  titleRu: string;
  titleUz: string;
  bodyRu: string;
  bodyUz: string;
}

export const PAGE_SEEDS: PageSeed[] = [
  {
    slug: 'about',
    titleRu: 'О бренде',
    titleUz: 'Brend haqida',
    bodyRu: `**LUMMI.** — парфюм по мотивам мировых ароматов. Мы делаем премиальные ароматы доступными: качественное сырьё, стойкость и аккуратная подача.

Найдите «свой» аромат и носите каждый день.`,
    bodyUz: `**LUMMI.** — dunyo mashhur iforlari asosidagi atirlar. Biz premium iforlarni hamma uchun qulay qilamiz: sifatli xomashyo, uzoq saqlanish va chiroyli qadoq.

Oʻz iforingizni toping va har kuni qoʻllang.`,
  },
  {
    slug: 'delivery-payment',
    titleRu: 'Доставка и оплата',
    titleUz: 'Yetkazib berish va toʻlov',
    bodyRu: `### Доставка

Отправляем почтой BTS в пункт BTS, который вы выбираете при оформлении заказа. Цена зависит от области и показана при оформлении, по умолчанию {defaultTariff}. При заказе от {freeDeliveryThreshold} доставка бесплатная.

Срок: {deliveryTerm} после передачи заказа в BTS. Если нужно уточнить, напишите менеджеру: {managerUsername}.

### Оплата

Перевод на карту и загрузка чека. На оплату после оформления есть {reserveTime}: всё это время товар ждёт вас. Заказ собираем после подтверждения оплаты.`,
    bodyUz: `### Yetkazib berish

BTS pochtasi orqali buyurtma rasmiylashtirilganda tanlagan BTS punktingizga yuboramiz. Narx viloyatga bogʻliq va rasmiylashtirishda koʻrinadi, odatda {defaultTariff}. {freeDeliveryThreshold}dan boshlab buyurtmalar uchun yetkazib berish bepul.

Muddat: buyurtma BTSga topshirilgandan keyin {deliveryTerm}. Aniqlashtirish kerak boʻlsa, menejerga yozing: {managerUsername}.

### Toʻlov

Kartaga oʻtkazma va chekni yuklash. Rasmiylashtirgandan keyin toʻlash uchun {reserveTime} vaqtingiz bor: shu vaqt davomida mahsulot siz uchun saqlanadi. Buyurtma toʻlov tasdiqlangach yigʻiladi.`,
  },
  {
    slug: 'returns',
    titleRu: 'Возврат и обмен',
    titleUz: 'Qaytarish va almashtirish',
    bodyRu: `Если товар пришёл повреждённым, с протечкой или не тот, что заказан, напишите нам в течение 3 дней после получения, приложив фото. Мы заменим товар или вернём деньги.

Вскрытая парфюмерия надлежащего качества обмену и возврату не подлежит.`,
    bodyUz: `Agar mahsulot shikastlangan, oqib ketgan yoki buyurtma qilinganidan boshqa boʻlsa, qabul qilgandan keyin 3 kun ichida rasm bilan bizga yozing. Mahsulotni almashtiramiz yoki pulni qaytaramiz.

Ochilgan sifatli atir-upa mahsulotlari almashtirilmaydi va qaytarilmaydi.`,
  },
  {
    slug: 'faq',
    titleRu: 'Вопросы и ответы',
    titleUz: 'Savol-javoblar',
    bodyRu: `### Это ароматы известных брендов?

Нет. Это ароматы LUMMI по мотивам известных парфюмов, на качественном парфюмерном сырье.

### Сколько держится аромат?

До 24 часов, зависит от кожи, погоды и аромата.

### Как наносить?

На запястья, шею, за уши. Не растирайте: так аромат раскрывается лучше.

### Как выбрать аромат, не понюхав его?

Возьмите Discovery set: несколько ароматов по 10 мл. Или напишите менеджеру.

### Как оплатить?

Переводом на карту: реквизиты и сумма появятся после оформления заказа, затем загрузите чек. На оплату есть {reserveTime}.

### Сколько стоит доставка?

Зависит от области, цена показана при оформлении, по умолчанию {defaultTariff}. От {freeDeliveryThreshold} доставка бесплатная. Срок: {deliveryTerm} после передачи в BTS.`,
    bodyUz: `### Bu mashhur brendlarning iforlarimi?

Yoʻq. Bu mashhur atirlar asosida yaratilgan LUMMI iforlari, sifatli atir xomashyosidan.

### Ifor qancha saqlanadi?

24 soatgacha, teri, ob-havo va iforga bogʻliq.

### Qanday surtiladi?

Bilak, boʻyin va quloq orqasiga. Ishqalamang: ifor yaxshiroq ochiladi.

### Hidlab koʻrmagan boʻlsam, iforni qanday tanlayman?

Discovery set oling: bir nechta 10 ml ifor. Yoki menejerga yozing.

### Qanday toʻlayman?

Kartaga oʻtkazma orqali: rekvizit va summa buyurtmadan keyin chiqadi, soʻng chekni yuklang. Toʻlash uchun {reserveTime} vaqtingiz bor.

### Yetkazib berish qancha turadi?

Viloyatga bogʻliq, narx rasmiylashtirishda koʻrinadi, odatda {defaultTariff}. {freeDeliveryThreshold}dan boshlab bepul. Muddat: BTSga topshirilgandan keyin {deliveryTerm}.`,
  },
  {
    slug: 'contacts',
    titleRu: 'Контакты',
    titleUz: 'Aloqa',
    bodyRu: `Мы на связи, чтобы помочь с выбором аромата и заказом.

- Менеджер: [{managerUsername}]({managerLink})
- Telegram-канал: [t.me/lummi_uz](https://t.me/lummi_uz)
- Instagram: [instagram.com/lummi.uz](https://instagram.com/lummi.uz)
- Магазин LUMMI на Uzum Market`,
    bodyUz: `Ifor tanlash va buyurtma boʻyicha yordam berish uchun aloqadamiz.

- Menejer: [{managerUsername}]({managerLink})
- Telegram kanal: [t.me/lummi_uz](https://t.me/lummi_uz)
- Instagram: [instagram.com/lummi.uz](https://instagram.com/lummi.uz)
- Uzum Market’dagi LUMMI doʻkoni`,
  },
  {
    slug: 'offer',
    titleRu: 'Публичная оферта',
    titleUz: 'Ommaviy oferta',
    bodyRu: `Текст публичной оферты будет опубликован здесь.

По любым вопросам напишите менеджеру: [{managerUsername}]({managerLink}).`,
    bodyUz: `Ommaviy oferta matni shu yerda e’lon qilinadi.

Savollar boʻlsa, menejerga yozing: [{managerUsername}]({managerLink}).`,
  },
];

/** Idempotent: never overwrites a text the owner has edited. */
export async function seedContent(db: Db): Promise<void> {
  await db
    .insert(contentTexts)
    .values({ key: SLOGAN_KEY, ru: SLOGAN_SEED.ru, uz: normalizeUzbek(SLOGAN_SEED.uz) })
    .onConflictDoNothing();
  await db
    .insert(infoPages)
    .values(
      PAGE_SEEDS.map((p, i) => ({
        slug: p.slug,
        sort: i,
        titleRu: p.titleRu,
        titleUz: normalizeUzbek(p.titleUz),
        bodyRu: p.bodyRu,
        bodyUz: normalizeUzbek(p.bodyUz),
        draft: true,
      })),
    )
    .onConflictDoNothing();
}

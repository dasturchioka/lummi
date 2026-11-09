import { contentTexts, infoPages, type Db } from '@lummi/db';
import { normalizeUzbek } from '@lummi/i18n';
import type { InfoPageSlug } from '@lummi/contracts';

/**
 * Draft texts from the TZ appendix (v1.11), seeded as drafts pending the customer's approval
 * (ticket #21). Changes from the TZ draft, all for the brand's copy rules (CLAUDE.md): the FAQ's
 * first question no longer uses the banned word «оригинал» (it asks about the known brands'
 * fragrances instead), and longevity reads «до 24 часов» / «24 soatgacha» as the customer decided
 * on 2026-11-07, not the draft's «[8–12]». The returns window «[3] дней» keeps its number but is
 * still to be confirmed (open-questions). The public offer is a placeholder: it comes from the
 * customer's lawyer.
 */
export const SLOGAN_SEED = {
  ru: 'Ароматы, которые освещают',
  uz: 'Lahzalaringizni yorituvchi iforlar',
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
    bodyUz: `**LUMMI.** — dunyo mashhur hidlari asosidagi atirlar. Biz premium hidlarni hamma uchun qulay qilamiz: sifatli xomashyo, uzoq saqlanish va chiroyli qadoq.

O‘z hidingizni toping va har kuni qo‘llang.`,
  },
  {
    slug: 'delivery-payment',
    titleRu: 'Доставка и оплата',
    titleUz: 'Yetkazib berish va to‘lov',
    bodyRu: `### Доставка

Доставляем по всему Узбекистану почтой BTS, до 48 часов с передачи в службу. Цена зависит от области, её видно при оформлении заказа.

### Оплата

Перевод на карту и загрузка чека. Заказ собираем после подтверждения оплаты. Оплатить нужно в течение 12 часов.`,
    bodyUz: `### Yetkazib berish

Butun O‘zbekiston bo‘ylab BTS pochtasi orqali, xizmatga topshirilgandan keyin 48 soatgacha yetkazamiz. Narx viloyatga bog‘liq, u buyurtma rasmiylashtirilganda ko‘rinadi.

### To‘lov

Kartaga o‘tkazma va chekni yuklash. Buyurtma to‘lov tasdiqlangach yig‘iladi. 12 soat ichida to‘lash kerak.`,
  },
  {
    slug: 'returns',
    titleRu: 'Возврат и обмен',
    titleUz: 'Qaytarish va almashtirish',
    bodyRu: `Если товар пришёл повреждённым, с протечкой или не тот, что заказан, напишите нам в течение 3 дней после получения, приложив фото. Мы заменим товар или вернём деньги.

Вскрытая парфюмерия надлежащего качества обмену и возврату не подлежит.`,
    bodyUz: `Agar mahsulot shikastlangan, oqib ketgan yoki buyurtma qilinganidan boshqa bo‘lsa, qabul qilgandan keyin 3 kun ichida rasm bilan bizga yozing. Mahsulotni almashtiramiz yoki pulni qaytaramiz.

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

Переводом на карту: реквизиты и сумма появятся после оформления заказа, затем загрузите чек.

### Сколько стоит доставка?

Зависит от области, цена показана при оформлении. Срок: до 48 часов.`,
    bodyUz: `### Bu mashhur brendlarning atirlarimi?

Yo‘q. Bu mashhur atirlar asosida yaratilgan LUMMI hidlari, sifatli atir xomashyosidan.

### Hid qancha saqlanadi?

24 soatgacha, teri, ob-havo va hidga bog‘liq.

### Qanday surtiladi?

Bilak, bo‘yin va quloq orqasiga. Ishqalamang: hid yaxshiroq ochiladi.

### Hidlab ko‘rmagan bo‘lsam, qanday tanlayman?

Discovery set oling: bir nechta 10 ml hid. Yoki menejerga yozing.

### Qanday to‘layman?

Kartaga o‘tkazma orqali: rekvizit va summa buyurtmadan keyin chiqadi, so‘ng chekni yuklang.

### Yetkazib berish qancha turadi?

Viloyatga bog‘liq, narx rasmiylashtirishda ko‘rinadi. Muddat: 48 soatgacha.`,
  },
  {
    slug: 'contacts',
    titleRu: 'Контакты',
    titleUz: 'Aloqa',
    bodyRu: `Мы на связи, чтобы помочь с выбором аромата и заказом.

- Менеджер: [@lummi_manager](https://t.me/lummi_manager)
- Telegram-канал: [t.me/lummi_uz](https://t.me/lummi_uz)
- Instagram: [instagram.com/lummi.uz](https://instagram.com/lummi.uz)
- Магазин LUMMI на Uzum Market`,
    bodyUz: `Hid tanlash va buyurtma bo‘yicha yordam berish uchun aloqadamiz.

- Menejer: [@lummi_manager](https://t.me/lummi_manager)
- Telegram kanal: [t.me/lummi_uz](https://t.me/lummi_uz)
- Instagram: [instagram.com/lummi.uz](https://instagram.com/lummi.uz)
- Uzum Market’dagi LUMMI do‘koni`,
  },
  {
    slug: 'offer',
    titleRu: 'Публичная оферта',
    titleUz: 'Ommaviy oferta',
    bodyRu: `Текст публичной оферты готовится вместе с юристом и появится здесь. Порядок перевода и возврата денег будет указан в ней.

По любым вопросам напишите менеджеру: [@lummi_manager](https://t.me/lummi_manager).`,
    bodyUz: `Ommaviy oferta matni yurist bilan birga tayyorlanmoqda va shu yerda paydo bo‘ladi. Pulni o‘tkazish va qaytarish tartibi unda ko‘rsatiladi.

Savollar bo‘lsa, menejerga yozing: [@lummi_manager](https://t.me/lummi_manager).`,
  },
];

/** Idempotent: never overwrites a text the owner has edited. */
export async function seedContent(db: Db): Promise<void> {
  await db
    .insert(contentTexts)
    .values({ key: 'home.slogan', ru: SLOGAN_SEED.ru, uz: normalizeUzbek(SLOGAN_SEED.uz) })
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

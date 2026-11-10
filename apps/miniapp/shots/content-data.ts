import type { ShotDb } from './db';

/**
 * Worst-case content for the #21 shots (break-ui): an info page of about 2 000 words in each
 * language, the longest UZ title with ʻ, every block and inline form, the settings placeholders,
 * and link targets the parser refuses (they must read as plain text). Copy follows the brand
 * rules: no banned words, «по мотивам», «вы» / «siz».
 */

const RU_PARAGRAPHS = [
  'Каждый аромат LUMMI начинается с настроения: тёплый вечер в городе, свежее утро у моря, тихий зимний день дома. Мы подбираем композицию по мотивам известных парфюмов и добиваемся того, чтобы она раскрывалась на коже так же красиво и оставляла шлейф до 24 часов. Высокая концентрация Extrait de Parfum позволяет наносить меньше, а носить дольше.',
  'Заказ оформляется в несколько шагов: выберите аромат и объём 10, 30 или 50 мл, добавьте его в корзину, укажите пункт BTS и получателя. Доставка по умолчанию стоит {defaultTariff}, а при заказе от {freeDeliveryThreshold} она бесплатная. Срок — до 48 часов после передачи заказа в BTS, в отдалённые районы иногда дольше.',
  'Если сомневаетесь в выборе, начните с набора Discovery set: пять ароматов по 10 мл в одной коробке. Носите каждый по несколько дней, запишите впечатления и возвращайтесь за полным объёмом того, который стал «своим». Менеджер {managerUsername} подскажет, что выбрать к вашему любимому аромату.',
];
const RU_LIST = [
  '**Тёплые, древесные** ароматы — для вечера и холодного сезона',
  '*Свежие и цитрусовые* — для утра, офиса и жаркого лета',
  'Цветочные — когда хочется лёгкости и внимания к деталям',
  'Восточные пряные композиции, которые раскрываются постепенно и долго держатся на одежде, шарфе и волосах, особенно в прохладную погоду',
];
const RU_HEADINGS = [
  'Как мы выбираем ароматы',
  'Доставка, сроки и пункты BTS',
  'Набор Discovery set для первого знакомства',
  'Как носить аромат, чтобы он держался весь день',
  'Оплата переводом на карту и проверка чека',
  'Возврат и обмен, если что-то пошло не так',
  'Подарки: открытка, упаковка и заказ без чека в посылке',
  'Хранение флакона дома и в поездке',
];

const UZ_PARAGRAPHS = [
  'Har bir LUMMI ifori kayfiyatdan boshlanadi: shahardagi iliq oqshom, dengiz boʻyidagi tonggi salqinlik, uydagi sokin qish kuni. Biz mashhur atirlar asosida kompozitsiya tanlaymiz va u teride chiroyli ochilib, 24 soatgacha iz qoldirishiga erishamiz. Extrait de Parfum yuqori konsentratsiyasi kamroq surtib, uzoqroq taqib yurish imkonini beradi.',
  'Buyurtma bir necha qadamda rasmiylashtiriladi: ifor va hajmni tanlang (10, 30 yoki 50 ml), savatga qoʻshing, BTS punkti va qabul qiluvchini koʻrsating. Yetkazib berish odatda {defaultTariff}, {freeDeliveryThreshold}dan boshlab esa bepul. Muddat — buyurtma BTSga topshirilgandan keyin 48 soatgacha.',
  'Tanlashda ikkilanayotgan boʻlsangiz, Discovery set toʻplamidan boshlang: bitta qutida 10 ml li beshta ifor. Har birini bir necha kun taqing, taassurotlaringizni yozib qoʻying va oʻzingizga yoqqanining toʻliq hajmi uchun qayting. Menejer {managerUsername} sevimli iforingizga mosini tanlashda yordam beradi.',
];
const UZ_LIST = [
  '**Iliq, yogʻochli** iforlar — oqshom va sovuq mavsum uchun',
  '*Yangi va sitrusli* — tong, ofis va issiq yoz uchun',
  'Gulli iforlar — yengillik va eʼtibor kerak boʻlganda',
  'Sharqona ziravorli kompozitsiyalar sekin ochiladi va kiyim, roʻmol hamda sochda uzoq saqlanadi, ayniqsa salqin havoda',
];
const UZ_HEADINGS = [
  'Iforlarni qanday tanlaymiz',
  'Yetkazib berish, muddatlar va BTS punktlari',
  'Birinchi tanishuv uchun Discovery set toʻplami',
  'Ifor kun boʻyi saqlanishi uchun uni qanday taqish kerak',
  'Kartaga oʻtkazma orqali toʻlov va chekni tekshirish',
  'Biror narsa notoʻgʻri boʻlsa, qaytarish va almashtirish',
  'Sovgʻalar: tabriknoma, qadoq va posilkada chek boʻlmasligi',
  'Flakonni uyda va safarda saqlash',
];

/** Links the parser must refuse: plain http, script, empty, unclosed. They render as text. */
const BROKEN_RU =
  'Ссылки, которые не откроются: [старый сайт](http://lummi.uz), [скрипт](javascript:alert(1)), [пустая]() и [без закрытия](https://t.me/lummi_uz. Рабочие: [канал](https://t.me/lummi_uz), [почта](mailto:hello@lummi.uz), [телефон](tel:+998901234567) и очень длинная ссылка [https://instagram.com/lummi.uz/stories/highlights/18012345678901234](https://instagram.com/lummi.uz/stories/highlights/18012345678901234).';
const BROKEN_UZ =
  'Ochilmaydigan havolalar: [eski sayt](http://lummi.uz), [skript](javascript:alert(1)), [boʻsh]() va [yopilmagan](https://t.me/lummi_uz. Ishlaydiganlari: [kanal](https://t.me/lummi_uz), [pochta](mailto:hello@lummi.uz), [telefon](tel:+998901234567) va juda uzun havola [https://instagram.com/lummi.uz/stories/highlights/18012345678901234](https://instagram.com/lummi.uz/stories/highlights/18012345678901234).';

function longBody(headings: string[], paragraphs: string[], list: string[], broken: string) {
  const sections = headings.map((h, i) => {
    const p = (n: number) => paragraphs[(i + n) % paragraphs.length] as string;
    const items = i % 2 === 0 ? list.map((x) => `- ${x}`) : list.map((x, n) => `${n + 1}. ${x}`);
    return [`### ${h}`, p(0), p(1), items.join('\n'), p(2)].join('\n\n');
  });
  return [paragraphs[0], ...sections, broken].join('\n\n');
}

export const LONG_PAGE = {
  titleRu: 'О бренде, доставке, оплате, возврате и подарках: всё, что важно знать до заказа',
  // 80 characters, the field's limit, with ʻ in four words
  titleUz: 'Brend, yetkazib berish, toʻlov, qaytarish va sovgʻalar haqida toʻliq qoʻllanma',
  bodyRu: longBody(RU_HEADINGS, RU_PARAGRAPHS, RU_LIST, BROKEN_RU),
  bodyUz: longBody(UZ_HEADINGS, UZ_PARAGRAPHS, UZ_LIST, BROKEN_UZ),
};

export interface PageTexts {
  titleRu: string;
  titleUz: string;
  bodyRu: string;
  bodyUz: string;
}

/**
 * Puts these texts on one seeded page for a shot (a field left out keeps its text); the teardown
 * puts the seeded texts back.
 */
export function onInfoPage(slug: string, texts: Partial<PageTexts>) {
  let saved: unknown[] | null = null;
  const write = (db: ShotDb, v: unknown[]) =>
    db.query(
      `update info_pages set title_ru = coalesce($2, title_ru), title_uz = coalesce($3, title_uz),
         body_ru = coalesce($4, body_ru), body_uz = coalesce($5, body_uz) where slug = $1`,
      [slug, ...v],
    );
  return {
    setup: async ({ db }: { db: ShotDb }) => {
      const { rows } = await db.query(
        `select title_ru, title_uz, body_ru, body_uz from info_pages where slug = $1`,
        [slug],
      );
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new Error(`no info page "${slug}"`);
      saved ??= [row.title_ru, row.title_uz, row.body_ru, row.body_uz];
      const v = [texts.titleRu, texts.titleUz, texts.bodyRu, texts.bodyUz];
      await write(
        db,
        v.map((x) => x ?? null),
      );
    },
    teardown: async ({ db }: { db: ShotDb }) => {
      if (saved) await write(db, saved);
    },
  };
}

/** A promo banner at every field's limit (60 / 160 / 40 characters), with ʻ in the UZ texts. */
export const LIMIT_BANNER = {
  titleRu: 'Осенняя коллекция: тёплые ароматы для долгих вечеров у огня.',
  titleUz: 'Kuzgi toʻplam: uzoq oqshomlar uchun iliq, yogʻochli iforlar',
  subtitleRu:
    'Пять ароматов по мотивам любимых парфюмов в одной коробке: попробуйте каждый по несколько дней и выберите свой полный объём со скидкой до конца этого месяца',
  subtitleUz:
    'Sevimli atirlar asosidagi beshta ifor bitta qutida: har birini bir necha kun taqib koʻring va oy oxirigacha chegirma bilan oʻzingizga yoqqanining toʻliq hajmini oling',
  priceLineRu: 'от 1 299 000 сум за набор из пяти штук',
  priceLineUz: 'Beshtalik toʻplam 1 299 000 soʻmdan',
};

/** The Home slogan at its 80-character limit (`SLOGAN_MAX`); the teardown puts the saved one back. */
export function longSlogan() {
  let saved: unknown[] | null = null;
  return {
    setup: async ({ db }: { db: ShotDb }) => {
      const { rows } = await db.query(`select ru, uz from content_texts where key = 'home.slogan'`);
      const row = rows[0] as Record<string, unknown> | undefined;
      saved ??= row ? [row.ru, row.uz] : [];
      await db.query(
        `insert into content_texts (key, ru, uz) values ('home.slogan', $1, $2)
         on conflict (key) do update set ru = excluded.ru, uz = excluded.uz`,
        [
          'Ароматы, которые освещают ваши вечера, утренние встречи и самые важные моменты',
          'Lahzalaringizni yorituvchi iforlar: oqshom, uchrashuv va muhim kunlaringiz uchun',
        ],
      );
    },
    teardown: async ({ db }: { db: ShotDb }) => {
      if (saved?.length) {
        await db.query(
          `update content_texts set ru = $1, uz = $2 where key = 'home.slogan'`,
          saved,
        );
      }
    },
  };
}

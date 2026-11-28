import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ShotSql } from './screens';

/**
 * Shot data for the «Контент» page (#62): three banners on, in the slider order they were switched
 * on, each with a bottle photo of its own, plus one that is off (idempotent: nothing is added once
 * a banner exists). The slogan and the six info pages are seeded by the API itself at start.
 */
export async function seedShotContent(apiUrl: string, cookie: string, repoRoot: string) {
  const json = { cookie, 'content-type': 'application/json' };
  const list = (await (
    await fetch(`${apiUrl}/admin/content/banners`, { headers: { cookie } })
  ).json()) as { id: number }[];
  if (list.length > 0) return;
  const dir = resolve(repoRoot, 'materials/flakons');
  const photos = readdirSync(dir)
    .filter((f) => f.endsWith('_30ml.webp'))
    .sort();
  const make = async (body: object) => {
    const res = await fetch(`${apiUrl}/admin/content/banners`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify(body),
    });
    if (res.status !== 201) throw new Error(`banner create failed: ${res.status}`);
    return ((await res.json()) as { id: number }).id;
  };
  const photo = async (id: number, n: number) => {
    const up = await fetch(`${apiUrl}/admin/content/banners/${id}/photo`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'image/webp' },
      body: readFileSync(resolve(dir, photos[n % photos.length] as string)),
    });
    if (up.status !== 200) throw new Error(`banner photo failed: ${up.status}`);
  };
  const on = async (id: number) => {
    const res = await fetch(`${apiUrl}/admin/content/banners/${id}/active`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ active: true }),
    });
    if (res.status !== 200) throw new Error(`banner activate failed: ${res.status}`);
  };
  for (const [i, body] of SLIDES.entries()) {
    const id = await make(body);
    await photo(id, i * 9);
    await on(id);
  }
  await make({
    titleRu: 'Подарочный набор',
    titleUz: 'Sovgʻa toʻplami',
    subtitleRu: 'Пять ароматов по 10 мл в одной коробке',
    subtitleUz: 'Bitta qutida 10 ml li beshta ifor',
    priceLineRu: null,
    priceLineUz: null,
    target: 'catalog',
  });
}

/** The three slides after the Discovery set, as an owner would write them. */
const SLIDES = [
  {
    titleRu: 'Осенняя подборка',
    titleUz: 'Kuzgi tanlov',
    subtitleRu: 'Тёплые, древесные ароматы на вечер',
    subtitleUz: 'Kechqurun uchun iliq, yogʻochli iforlar',
    priceLineRu: 'от 69 000 сум',
    priceLineUz: '69 000 soʻmdan',
    target: 'catalog',
  },
  {
    titleRu: 'Соберите свой набор',
    titleUz: 'Oʻz toʻplamingizni yigʻing',
    subtitleRu: 'Пять ароматов по 10 мл, которые выберете вы',
    subtitleUz: 'Oʻzingiz tanlagan 10 ml li beshta ifor',
    priceLineRu: null,
    priceLineUz: null,
    target: 'builder',
  },
  {
    titleRu: 'Подарок к празднику',
    titleUz: 'Bayramga sovgʻa',
    subtitleRu: 'Упакуем аромат и вложим открытку с вашими словами',
    subtitleUz: 'Iforni qadoqlaymiz va soʻzlaringiz bilan tabriknoma qoʻshamiz',
    priceLineRu: 'от 149 000 сум',
    priceLineUz: '149 000 soʻmdan',
    target: 'catalog',
  },
];

/**
 * The worst case (break-ui, #62): the slider full, five banners on (six slides with the Discovery
 * set), every one with a long title, one an unbroken word. The seeded slides step aside for the
 * capture (switched off) and come back after it in their order.
 */
let savedOn: unknown[] | undefined;
export const bannersWorst = {
  setup: async ({ db }: { db: ShotSql }) => {
    const { rows } = await db.query(
      'select id from promo_banners where active order by position, id',
    );
    savedOn ??= rows.map((r) => r.id);
    await db.query('update promo_banners set active = false');
    for (const [i, b] of WORST_SLIDES.entries()) {
      await db.query(
        `insert into promo_banners (image_hash, title_ru, title_uz, subtitle_ru, subtitle_uz, price_line_ru, price_line_uz, target, active, position)
         values ((select image_hash from promo_banners where image_hash is not null order by id offset $8 limit 1), $1, $2, $3, $4, $5, $6, 'catalog', true, $7)`,
        [
          b.titleRu,
          b.titleUz,
          b.subtitleRu,
          b.subtitleUz,
          b.priceLineRu,
          b.priceLineUz,
          900 + i,
          i % 3,
        ],
      );
    }
  },
  teardown: async ({ db }: { db: ShotSql }) => {
    await db.query('delete from promo_banners where position >= 900');
    for (const [i, id] of (savedOn ?? []).entries()) {
      await db.query('update promo_banners set active = true, position = $2 where id = $1', [
        id,
        i + 1,
      ]);
    }
  },
};
const LONG = {
  subtitleRu:
    'Пять ароматов по мотивам любимых парфюмов в одной коробке: попробуйте каждый по несколько дней и выберите свой полный объём со скидкой до конца этого месяца',
  subtitleUz:
    'Sevimli atirlar asosidagi beshta ifor bitta qutida: har birini bir necha kun taqib koʻring va oy oxirigacha chegirma bilan oʻzingizga yoqqanining toʻliq hajmini oling',
  priceLineRu: 'от 1 299 000 сум за набор из пяти штук',
  priceLineUz: 'Beshtalik toʻplam 1 299 000 soʻmdan',
};
const WORST_SLIDES = [
  {
    ...LONG,
    titleRu: 'Осенняя коллекция: тёплые ароматы для долгих вечеров у огня.',
    titleUz: 'Kuzgi toʻplam: uzoq oqshomlar uchun iliq, yogʻochli iforlar',
  },
  {
    ...LONG,
    titleRu: 'Сверхдлинноеназваниеакциидляпроверкипереноса',
    titleUz: 'Juda uzun nomli aksiya sarlavhasi tekshiruv uchun',
  },
  ...[3, 4, 5].map((n) => ({
    ...LONG,
    titleRu: `Подарок к празднику: только до конца месяца, ${n} из 5`,
    titleUz: `Bayramga sovgʻa: faqat oy oxirigacha, beshtadan ${n}`,
  })),
];

/** The banner editor at every field's limit (60 / 160 / 40 characters), typed into the form. */
export const LIMIT_BANNER = {
  ru: {
    title: 'Осенняя коллекция: тёплые ароматы для долгих вечеров у огня.',
    subtitle:
      'Пять ароматов по мотивам любимых парфюмов в одной коробке: попробуйте каждый по несколько дней и выберите свой полный объём со скидкой до конца этого месяца',
    priceLine: 'от 1 299 000 сум за набор из пяти штук',
  },
  uz: {
    title: 'Kuzgi toʻplam: uzoq oqshomlar uchun iliq, yogʻochli iforlar',
    subtitle:
      'Sevimli atirlar asosidagi beshta ifor bitta qutida: har birini bir necha kun taqib koʻring va oy oxirigacha chegirma bilan oʻzingizga yoqqanining toʻliq hajmini oling',
    priceLine: 'Beshtalik toʻplam 1 299 000 soʻmdan',
  },
};

const RU_SECTION = `### Как выбрать аромат, который станет «своим»

Начните с набора Discovery set: пять ароматов по 10 мл. Носите каждый несколько дней, а потом возвращайтесь за полным объёмом. Доставка по умолчанию {defaultTariff}, от {freeDeliveryThreshold} бесплатно, срок до 48 часов после передачи в BTS.

- **Тёплые, древесные** — для вечера
- *Свежие* — для утра и лета
- Пряные композиции, которые долго держатся на одежде, шарфе и волосах в прохладную погоду

Вопросы: [{managerUsername}]({managerLink}), [канал](https://t.me/lummi_uz), [старый сайт](http://lummi.uz).`;
const UZ_SECTION = `### Hidlab koʻrmasdan oʻzingizga mos iforni qanday tanlash mumkin

Discovery set toʻplamidan boshlang: 10 ml li beshta ifor. Har birini bir necha kun taqing, keyin toʻliq hajm uchun qayting. Yetkazib berish odatda {defaultTariff}, {freeDeliveryThreshold}dan bepul, muddat BTSga topshirilgandan keyin 48 soatgacha.

- **Iliq, yogʻochli** — oqshom uchun
- *Yangi* — tong va yoz uchun
- Ziravorli kompozitsiyalar salqin havoda kiyim, roʻmol va sochda uzoq saqlanadi

Savollar: [{managerUsername}]({managerLink}), [kanal](https://t.me/lummi_uz), [eski sayt](http://lummi.uz).`;

/** A long page typed into the page editor (not saved): six sections, the 80-character UZ title. */
export const LONG_PAGE = {
  ru: {
    title: 'О бренде, доставке, оплате, возврате и подарках: всё, что важно знать до заказа',
    body: Array(6).fill(RU_SECTION).join('\n\n'),
  },
  uz: {
    title: 'Brend, yetkazib berish, toʻlov, qaytarish va sovgʻalar haqida toʻliq qoʻllanma',
    body: Array(6).fill(UZ_SECTION).join('\n\n'),
  },
};

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Shot data for the «Контент» page: one active promo banner with a bottle photo, plus a second
 * that is switched off (idempotent: nothing is added once a banner exists). The slogan and the
 * six info pages are seeded by the API itself at start.
 */
export async function seedShotContent(apiUrl: string, cookie: string, repoRoot: string) {
  const json = { cookie, 'content-type': 'application/json' };
  const list = (await (
    await fetch(`${apiUrl}/admin/content/banners`, { headers: { cookie } })
  ).json()) as { id: number }[];
  if (list.length > 0) return;
  const dir = resolve(repoRoot, 'materials/flakons');
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('_30ml.webp'))
    .sort()[0] as string;
  const photo = readFileSync(resolve(dir, file));
  const make = async (body: object) => {
    const res = await fetch(`${apiUrl}/admin/content/banners`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify(body),
    });
    if (res.status !== 201) throw new Error(`banner create failed: ${res.status}`);
    return ((await res.json()) as { id: number }).id;
  };
  const first = await make({
    titleRu: 'Осенняя подборка',
    titleUz: 'Kuzgi tanlov',
    subtitleRu: 'Тёплые, древесные ароматы на вечер',
    subtitleUz: 'Kechqurun uchun iliq, yogʻochli iforlar',
    priceLineRu: 'от 69 000 сум',
    priceLineUz: '69 000 soʻmdan',
    target: 'catalog',
  });
  const up = await fetch(`${apiUrl}/admin/content/banners/${first}/photo`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'image/webp' },
    body: photo,
  });
  if (up.status !== 200) throw new Error(`banner photo failed: ${up.status}`);
  const on = await fetch(`${apiUrl}/admin/content/banners/${first}/active`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ active: true }),
  });
  if (on.status !== 200) throw new Error(`banner activate failed: ${on.status}`);
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

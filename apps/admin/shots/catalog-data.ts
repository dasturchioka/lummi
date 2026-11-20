/**
 * Worst-case catalog rows for the screenshots (ticket #17): a 40-character name and brand, long
 * RU/UZ texts, seven-digit prices with a markdown, no photo, every flag on and hidden; a
 * hyphenated 40-character name with one sold-out volume; a long dictionary entry. Written through
 * the real admin endpoints, idempotent by name, next to the 67 seeded fragrances.
 */
type Call = (path: string, method: string, body?: unknown) => Promise<Response>;

export const WORST_NAME = 'Ambre Nuit Extraordinaire Privée Édition';
export const HYPHEN_NAME = 'Velours-Fumé-Extraordinaire-Intense-Rare';

const DESCRIPTION_RU =
  'Вечер, который не хочется заканчивать. Ambre Nuit открывается чёрной смородиной и розовым перцем, а потом медленно уходит в тёплую амбру, ваниль и мягкую кожу. Аромат для вечера и особых встреч: он оставляет шлейф, который замечают, и держится до утра. В холодный сезон раскрывается особенно глубоко — тёплый, древесный, с лёгкой дымкой. На коже звучит близко и уверенно, на одежде остаётся надолго.\n\nПодойдёт тем, кто любит насыщенные, обволакивающие композиции и не боится внимания. Носите его на ужин, в театр, на долгую прогулку по зимнему городу или в день, который хочется запомнить. Двух-трёх нажатий достаточно: аромат сам заполнит пространство вокруг и будет тихо напоминать о себе весь вечер.';
const DESCRIPTION_UZ =
  'Tugashini istamaydigan oqshom. Ambre Nuit qora smorodina va pushti qalampir bilan ochiladi, soʻng sekin iliq ambra, vanil va yumshoq teriga oʻtadi. Kechki uchrashuvlar va alohida lahzalar uchun atir: u sezilarli iz qoldiradi va tonggacha saqlanadi. Sovuq mavsumda ayniqsa chuqur ochiladi — iliq, yogʻochli, yengil tutun bilan. Terida yaqin va ishonchli yangraydi, kiyimda uzoq qoladi.\n\nToʻyingan, oʻrab oluvchi kompozitsiyalarni yaxshi koʻradigan va e’tibordan qoʻrqmaydiganlar uchun. Uni kechki ovqatga, teatrga, qishki shahar boʻylab uzoq sayrga yoki eslab qolmoqchi boʻlgan kuningizga taqing. Ikki-uch marta sepish kifoya: atir atrofni oʻzi toʻldiradi va butun oqshom ohista oʻzini eslatib turadi.';

type Item = { id: number; name?: string; nameRu?: string };

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function seedShotCatalog(call: Call) {
  const list = await json<Item[]>(await call('/admin/catalog/fragrances', 'GET'), 'list');
  const families = await json<Item[]>(await call('/admin/catalog/families', 'GET'), 'families');
  const longNote = 'аккорд тёплой амбры и ванильной кожи с дымным деревом и бархатной пудрой';
  let notes = await json<Item[]>(await call('/admin/catalog/notes', 'GET'), 'notes');
  if (!notes.some((n) => n.nameRu === longNote)) {
    const res = await call('/admin/catalog/notes', 'POST', {
      nameRu: longNote,
      nameUz: 'iliq ambra va vanilli teri va tutunli yogʻoch va baxmal upa akkordi',
      aliases: ['ambre velours', 'amber suede', 'тёплая амбра', 'vanilla leather', 'smoky wood'],
    });
    if (res.status !== 201) throw new Error(`could not add the long note: ${res.status}`);
    notes = await json<Item[]>(await call('/admin/catalog/notes', 'GET'), 'notes');
  }

  const common = {
    familyId: families[0]?.id ?? null,
    longevityRu: 'до 24 часов',
    longevityUz: '24 soatgacha',
    internalRemark: 'Партия от сентября; фото ждём от фотографа к концу недели.',
    uzumUrl: null,
  };
  // the twelve longest names as «Похожие ароматы» (the most the form allows)
  const similarIds = [...list]
    .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))
    .slice(0, 12)
    .map((f) => f.id);
  // the long note opens the top notes, so its chip is on screen
  const long = notes.find((n) => n.nameRu === longNote)!.id;
  const ids = [long, ...notes.map((n) => n.id).filter((id) => id !== long)];

  const rows = [
    {
      ...common,
      name: WORST_NAME,
      originalBrand: 'Maison Francis Kurkdjian Haute Parfumeur',
      type: 'unisex',
      season: 'autumn_winter',
      timeOfDay: 'evening',
      sillage: 'strong',
      descriptionRu: DESCRIPTION_RU,
      descriptionUz: DESCRIPTION_UZ,
      whenToWearRu:
        'Осень и зима, вечер. Ужин, театр, свидание, долгие зимние прогулки и любой день, который хочется запомнить надолго.',
      whenToWearUz:
        'Kuz va qish, oqshom. Kechki ovqat, teatr, uchrashuv, uzoq qishki sayrlar va uzoq eslab qolmoqchi boʻlgan har qanday kun.',
      keyNotesRu: ['чёрная смородина', 'розовый перец', 'амбровое дерево'],
      keyNotesUz: ['qora smorodina', 'pushti qalampir', 'ambra yogʻochi'],
      aliases: ['Ambre Nuit Privee Edition', 'Амбр Нюи', 'ambre nuit extraordinaire'],
      isHit: true,
      isNew: true,
      hidden: true,
      notes: { top: ids.slice(0, 7), heart: ids.slice(7, 14), base: ids.slice(14, 21) },
      similarIds,
      volumes: [
        { ml: 10, price: 1_250_000, salePrice: null, saleEndsOn: null },
        { ml: 30, price: 2_450_000, salePrice: 1_990_000, saleEndsOn: '2026-12-31' },
        { ml: 50, price: 3_990_000, salePrice: null, saleEndsOn: null },
      ],
      concentrateMl: 12_875.5,
    },
    {
      ...common,
      name: HYPHEN_NAME,
      originalBrand: 'Atelier',
      type: 'femme',
      season: 'spring_summer',
      timeOfDay: 'day',
      sillage: 'medium',
      descriptionRu: 'Лёгкий дневной аромат.',
      descriptionUz: 'Yengil kunduzgi atir.',
      whenToWearRu: 'Весна и лето, днём.',
      whenToWearUz: 'Bahor va yoz, kunduzi.',
      keyNotesRu: ['ирис', 'замша', 'мускус'],
      keyNotesUz: ['iris', 'zamsha', 'mushk'],
      aliases: [],
      isHit: false,
      isNew: false,
      hidden: false,
      notes: { top: ids.slice(21, 22), heart: [], base: [] },
      similarIds: [],
      volumes: [{ ml: 10, price: 99_000, salePrice: null, saleEndsOn: null }],
      concentrateMl: 0,
    },
  ];
  for (const row of rows) {
    if (list.some((f) => f.name === row.name)) continue;
    const res = await call('/admin/catalog/fragrances', 'POST', row);
    if (res.status !== 201) {
      throw new Error(`could not add ${row.name}: ${res.status} ${await res.text()}`);
    }
  }
}

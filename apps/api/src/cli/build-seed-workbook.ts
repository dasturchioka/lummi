import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeUzbek } from '@lummi/i18n';
import { slugify } from '../catalog/slug';
import {
  LONGEVITY,
  PLACEHOLDER_CONCENTRATE_ML,
  PLACEHOLDER_PRICES,
  SEED_ALIASES,
  SEED_WORKBOOK,
} from '../catalog/seed';
import {
  writeWorkbook,
  type CatalogData,
  type FragranceDraft,
  type LABELS,
  readWorkbook,
} from '../catalog-import/workbook';
import { planImport } from '../catalog-import/plan';
import type { Snapshot } from '../catalog-import/snapshot';

/**
 * Rebuilds the seed workbook `apps/api/seed/LUMMI_Katalog.xlsx` from the customer's guide
 * (`materials/catalog/`): the 67 fragrances in the import template, then the customer's later
 * additions (`materials/catalog/LUMMI_Katalog_15_novyh.xlsx`, codes 068–082, already in the
 * template, cost columns stripped), with placeholder prices and
 * stock (docs/catalog-sample.md) and longevity «до 24 часов». The cost columns (#75) stay empty:
 * the oil prices come from the file at OIL_PRICES_FILE (`seedOilPrices`). The workbook is
 * committed; this script is how it was made and how it is remade when the guide changes:
 *   npm run seed:workbook -w @lummi/api
 * The seed (and the customer, as their example) then use the workbook through the import.
 */
interface GuideRecord {
  id: number;
  brand: string;
  name: string;
  similar_ids: number[];
  ru: Record<string, string>;
  uz: Record<string, string>;
}
const TYPE = { Мужской: 'homme', Женский: 'femme', Унисекс: 'unisex' } as const;
const SILLAGE = { Средний: 'medium', Заметный: 'noticeable', Сильный: 'strong' } as const;
const SEASON = {
  'Весна–лето': 'spring_summer',
  'Осень–зима': 'autumn_winter',
  'Круглый год': 'all_year',
  'Весна–осень': 'spring_autumn',
} as const;
const TIME = {
  Днём: 'day',
  Вечер: 'evening',
  'День и вечер': 'day_evening',
  'На каждый день': 'everyday',
} as const;

function pick<T extends Record<string, string>>(map: T, key: string, what: string): T[keyof T] {
  const v = map[key];
  if (!v) throw new Error(`catalog guide: unknown ${what} "${key}"`);
  return v as T[keyof T];
}
const list = (s: string | undefined, sep: string | RegExp) =>
  (s ?? '')
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
const code = (id: number) => String(id).padStart(3, '0');

const materials = fileURLToPath(new URL('../../../../materials', import.meta.url));
const guide = JSON.parse(
  await readFile(`${materials}/catalog/lummi_aromatlar.json`, 'utf8'),
) as GuideRecord[];
const notes: { nameRu: string; nameUz: string }[] = [];
const lexicon = await readFile(`${materials}/catalog/notalar_lugati.txt`, 'utf8');
for (const line of lexicon.split('\n').slice(1)) {
  const [ru, uz] = line.split(' — ');
  if (ru && uz) notes.push({ nameRu: ru.trim(), nameUz: normalizeUzbek(uz.trim()) });
}
const familyPairs = new Map<string, string>();
for (const r of guide) familyPairs.set(r.ru.semeystvo!, normalizeUzbek(r.uz.oila!));

const data: CatalogData = {
  families: [...familyPairs].map(([nameRu, nameUz]) => ({ nameRu, nameUz })),
  notes,
  fragrances: guide.map((r) => {
    const draft: FragranceDraft = {
      code: code(r.id),
      name: r.name,
      originalBrand: r.brand,
      type: pick(TYPE, r.ru.pol!, 'type') as keyof typeof LABELS.type,
      family: r.ru.semeystvo!,
      season: pick(SEASON, r.ru.sezon!, 'season') as keyof typeof LABELS.season,
      timeOfDay: pick(TIME, r.ru.vremya!, 'time of day') as keyof typeof LABELS.timeOfDay,
      sillage: pick(SILLAGE, r.ru.shleyf!, 'sillage') as keyof typeof LABELS.sillage,
      longevityRu: LONGEVITY.ru,
      longevityUz: LONGEVITY.uz,
      descriptionRu: r.ru.ob_aromate!,
      descriptionUz: normalizeUzbek(r.uz.ifor_haqida!),
      whenToWearRu: r.ru.kogda_nosit!,
      whenToWearUz: normalizeUzbek(r.uz.qachon_taqish!),
      keyNotesRu: list(r.ru.klyuchevye_noty, '·'),
      keyNotesUz: list(normalizeUzbek(r.uz.asosiy_notalar!), '·'),
      topNotes: list(r.ru.verhnie_noty, ','),
      heartNotes: list(r.ru.noty_serdca, ','),
      baseNotes: list(r.ru.bazovye_noty, ','),
      similar: r.similar_ids.filter((id) => guide.some((g) => g.id === id)).map(code),
      internalRemark: r.ru.primechanie ?? '',
      aliases: SEED_ALIASES[slugify(r.name)] ?? [],
      uzumUrl: '',
      isHit: false,
      isNew: false,
      hidden: false,
      // the cost columns stay empty: oil prices are the customer's and never in the repository;
      // the seed takes them from OIL_PRICES_FILE (#75)
      oilPrice: null,
      tier: null,
      oilSupplier: '',
      oilInvoice: '',
      // ours, like the prices: the owner counts his concentrate (ADR 0043)
      concentrateMl: PLACEHOLDER_CONCENTRATE_ML,
    };
    return {
      draft,
      volumes: ([10, 30, 50] as const).map((ml) => ({
        ml,
        price: PLACEHOLDER_PRICES[ml],
        salePrice: null,
        saleEndsOn: null,
      })),
    };
  }),
};

// The customer's additions, filled in the import template itself (2026-11-23: 068–082). Read
// through the importer against the guide's catalog, so their similar codes and notes resolve;
// prices, concentrate and cost columns follow the guide's rules above, the rest is the customer's.
for (const file of ['LUMMI_Katalog_15_novyh.xlsx']) {
  const raw = await readWorkbook(await readFile(`${materials}/catalog/${file}`), {
    maxRows: 100_000,
  });
  let id = 1;
  const snap: Snapshot = {
    families: data.families.map((f) => ({ ...f, id: id++ })),
    notes: data.notes.map((n) => ({ ...n, id: id++ })),
    byCode: new Map(
      data.fragrances.map((f) => [
        f.draft.code,
        { id: id++, slug: slugify(f.draft.name), draft: f.draft, volumes: new Map() },
      ]),
    ),
  };
  const plan = planImport(raw, snap, { today: '2026-11-23' });
  if (plan.errors.length) {
    throw new Error(
      `${file}: ${plan.errors.map((e) => `${e.sheet} row ${e.row} ${e.column ?? ''} ${e.code}`).join('; ')}`,
    );
  }
  for (const f of plan.families)
    if (f.existingId === null) data.families.push({ nameRu: f.nameRu, nameUz: f.nameUz });
  for (const n of plan.notes)
    if (n.existingId === null) data.notes.push({ nameRu: n.nameRu, nameUz: n.nameUz });
  for (const f of plan.fragrances) {
    if (f.existingId !== null) throw new Error(`${file}: ${f.code} is already in the guide`);
    data.fragrances.push({
      draft: {
        ...f.draft,
        longevityRu: LONGEVITY.ru,
        longevityUz: LONGEVITY.uz,
        oilPrice: null,
        tier: null,
        oilSupplier: '',
        oilInvoice: '',
        concentrateMl: PLACEHOLDER_CONCENTRATE_ML,
      },
      volumes: ([10, 30, 50] as const).map((ml) => ({
        ml,
        price: PLACEHOLDER_PRICES[ml],
        salePrice: null,
        saleEndsOn: null,
      })),
    });
  }
}

await writeFile(SEED_WORKBOOK, await writeWorkbook(data));
console.log(`Wrote ${SEED_WORKBOOK}: ${data.fragrances.length} fragrances.`);

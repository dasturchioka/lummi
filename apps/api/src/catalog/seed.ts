import {
  families,
  fragranceNotes,
  fragranceSimilar,
  fragrances,
  notes,
  sql,
  volumes,
  type Db,
} from '@lummi/db';
import { normalizeUzbek } from '@lummi/i18n';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileStore } from '../edges';
import { reindexFragrances } from '../search/search-index';
import { storePhoto } from './photo-pipeline';

/**
 * Seed from the customer's guide (`materials/catalog/`, ADR 0018): 67 fragrances with RU/UZ text,
 * families, notes by level, curated similar fragrances, and their bottle photos through the photo
 * pipeline. Everything the guide does not give is OURS and flagged `is_placeholder`:
 * prices and stock (docs/catalog-sample.md -> Seed data). Idempotent: run it again and rows are
 * updated in place; an existing volume keeps its price and stock (only its photo is refreshed).
 */
export const PLACEHOLDER_PRICES = { 10: 69_000, 30: 149_000, 50: 219_000 } as const;
export const PLACEHOLDER_ON_HAND = 20;
/** Customer, 2026-11-07: «до 24 часов» for every fragrance, whatever the guide says. */
export const LONGEVITY = { ru: 'до 24 часов', uz: '24 soatgacha' } as const;

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

/** The name in ASCII kebab case: `Angels' Share` -> `angels-share`, `Météore` -> `meteore`. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’ʻʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Spelling variants (aliases) for names whose Cyrillic or phonetic reading does not follow from
 * the Latin spelling (French and English). Provisional: the customer's list and the admin panel
 * replace them. Written only while a fragrance has no aliases, so an admin's edits are kept.
 */
export const SEED_ALIASES: Record<string, string[]> = {
  'sauvage-edt': ['Соваж', 'Саваж', 'Sovaj'],
  'bleu-de-chanel': ['Блю де Шанель', 'Blyu de Shanel'],
  'baccarat-rouge-540': ['Баккара Руж', 'Bakara Ruj'],
  meteore: ['Метеор', 'Meteor'],
  'good-girl-gone-bad': ['Гуд Гёрл Ган Бэд', 'Gud Gerl Gon Bed'],
  'miss-dior-blooming-bouquet': ['Мисс Диор Блуминг Букет'],
  'bal-dafrique': ['Баль д’Африк', 'Bal Dafrik'],
  'oud-wood': ['Уд Вуд', 'Oud Vud'],
}

const list = (s: string, sep: string | RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);

export interface SeedOptions {
  /** `materials/` of the repo (read-only). */
  materialsDir: string;
  /** With a store, the bottle photos go through the pipeline; without, volumes get no photo. */
  photos?: FileStore;
  /** Only the first N records (tests). */
  limit?: number;
}

export async function seedCatalog(db: Db, opts: SeedOptions): Promise<{ fragrances: number }> {
  const guide = (
    JSON.parse(
      await readFile(join(opts.materialsDir, 'catalog/lummi_aromatlar.json'), 'utf8'),
    ) as GuideRecord[]
  ).slice(0, opts.limit);
  const lexicon = new Map<string, string>();
  const lexText = await readFile(join(opts.materialsDir, 'catalog/notalar_lugati.txt'), 'utf8');
  for (const line of lexText.split('\n').slice(1)) {
    const [ru, uz] = line.split(' — ');
    if (ru && uz) lexicon.set(ru.trim(), normalizeUzbek(uz.trim()));
  }

  // Photos first (slow, no DB): slug -> ml -> hash.
  const photoHash = new Map<string, string>();
  if (opts.photos) {
    for (const r of guide) {
      for (const ml of [10, 30, 50]) {
        const slug = slugify(r.name);
        const file = join(opts.materialsDir, `flakons/${slug}_${ml}ml.webp`);
        const { hash } = await storePhoto(opts.photos, await readFile(file));
        photoHash.set(`${slug}:${ml}`, hash);
      }
    }
  }

  await db.transaction(async (tx) => {
    // Dictionaries.
    const familyPairs = new Map<string, string>();
    for (const r of guide) familyPairs.set(r.ru.semeystvo!, normalizeUzbek(r.uz.oila!));
    const familyRows = await tx
      .insert(families)
      .values([...familyPairs].map(([nameRu, nameUz]) => ({ nameRu, nameUz })))
      .onConflictDoUpdate({ target: families.nameRu, set: { nameUz: sql`excluded.name_uz` } })
      .returning();
    const familyId = new Map(familyRows.map((f) => [f.nameRu, f.id]));

    const noteRows = await tx
      .insert(notes)
      .values([...lexicon].map(([nameRu, nameUz]) => ({ nameRu, nameUz })))
      .onConflictDoUpdate({ target: notes.nameRu, set: { nameUz: sql`excluded.name_uz` } })
      .returning();
    const noteId = new Map(noteRows.map((n) => [n.nameRu, n.id]));

    const idBySlug = new Map<string, number>();
    const idByGuideId = new Map<number, number>();
    for (const r of guide) {
      const slug = slugify(r.name);
      const values = {
        slug,
        code: String(r.id).padStart(3, '0'),
        name: r.name,
        originalBrand: r.brand,
        type: pick(TYPE, r.ru.pol!, 'type'),
        familyId: familyId.get(r.ru.semeystvo!) ?? null,
        season: pick(SEASON, r.ru.sezon!, 'season'),
        timeOfDay: pick(TIME, r.ru.vremya!, 'time of day'),
        longevityRu: LONGEVITY.ru,
        longevityUz: LONGEVITY.uz,
        sillage: pick(SILLAGE, r.ru.shleyf!, 'sillage'),
        descriptionRu: r.ru.ob_aromate!,
        descriptionUz: normalizeUzbek(r.uz.ifor_haqida!),
        whenToWearRu: r.ru.kogda_nosit!,
        whenToWearUz: normalizeUzbek(r.uz.qachon_taqish!),
        keyNotesRu: list(r.ru.klyuchevye_noty!, '·'),
        keyNotesUz: list(normalizeUzbek(r.uz.asosiy_notalar!), '·'),
        internalRemark: r.ru.primechanie || null,
        aliases: SEED_ALIASES[slug] ?? [],
        updatedAt: new Date(),
      };
      const [row] = await tx
        .insert(fragrances)
        .values(values)
        .onConflictDoUpdate({
          target: fragrances.slug,
          set: {
            ...values,
            aliases: sql`case when cardinality(${fragrances.aliases}) = 0 then excluded.aliases else ${fragrances.aliases} end`,
          },
        })
        .returning({ id: fragrances.id });
      const fid = row!.id;
      idBySlug.set(slug, fid);
      idByGuideId.set(r.id, fid);

      // Notes by level, in the guide's order.
      await tx.delete(fragranceNotes).where(sql`fragrance_id = ${fid}`);
      const links = (
        [
          ['top', r.ru.verhnie_noty],
          ['heart', r.ru.noty_serdca],
          ['base', r.ru.bazovye_noty],
        ] as const
      ).flatMap(([level, text]) =>
        list(text ?? '', ',').map((name, position) => {
          const nid = noteId.get(name);
          if (!nid) throw new Error(`catalog guide: note "${name}" is not in the dictionary`);
          return { fragranceId: fid, noteId: nid, level, position };
        }),
      );
      if (links.length) await tx.insert(fragranceNotes).values(links);

      for (const ml of [10, 30, 50] as const) {
        const hash = photoHash.get(`${slug}:${ml}`) ?? null;
        await tx
          .insert(volumes)
          .values({
            fragranceId: fid,
            ml,
            price: PLACEHOLDER_PRICES[ml],
            onHand: PLACEHOLDER_ON_HAND,
            photoHash: hash,
            isPlaceholder: true,
          })
          .onConflictDoUpdate({
            target: [volumes.fragranceId, volumes.ml],
            // Never clobber a price or stock someone has since set; only the photo follows the seed.
            set: hash ? { photoHash: hash } : { fragranceId: fid },
          });
      }
    }

    // Curated similar fragrances, ordered; ids inside the catalog only.
    for (const r of guide) {
      const fid = idByGuideId.get(r.id)!;
      await tx.delete(fragranceSimilar).where(sql`fragrance_id = ${fid}`);
      const rows = r.similar_ids.flatMap((gid, position) => {
        const similarId = idByGuideId.get(gid);
        return similarId ? [{ fragranceId: fid, similarId, position }] : [];
      });
      if (rows.length) await tx.insert(fragranceSimilar).values(rows);
    }
    // The search documents follow the rows just written (ADR 0019).
    await reindexFragrances(tx, [...idByGuideId.values()]);
  });
  return { fragrances: guide.length };
}

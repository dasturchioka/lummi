import { createHash } from 'node:crypto';
import { FIVE_ML_SET_KEY, MAIN_SET_KEY, SET_SIZE } from '@lummi/contracts/constants';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  and,
  asc,
  consumables,
  discoverySet,
  discoverySetItems,
  eq,
  families,
  fragrances,
  inArray,
  notes,
  sql,
  volumes,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { defaultCostSettings, mixNeeds } from '../cost/unit-cost';
import { AuditService } from '../audit/audit.service';
import { CatalogAdminService } from '../admin/catalog-admin.service';
import { CatalogImportService } from '../catalog-import/catalog-import.service';
import { normaliseCode } from '../catalog-import/plan';
import { readWorkbook } from '../catalog-import/workbook';
import { SystemClock, type Edges, type FileStore } from '../edges';
import { slugify } from './slug';
import { storePhoto } from './photo-pipeline';

/**
 * Seed from the customer's guide, loaded through the Excel import (#26). The guide (`materials/catalog/`,
 * ADR 0018) was converted once into the import template `apps/api/seed/LUMMI_Katalog.xlsx`
 * (`npm run seed:workbook -w @lummi/api`): 82 fragrances (the guide's 67 and 068–082) with RU/UZ text, families, notes by level,
 * curated similar fragrances. Everything the guide does not give is OURS and flagged `is_placeholder`:
 * prices and the ready concentrate (docs/catalog-sample.md -> Seed data). The bottle photos go
 * through the photo pipeline afterwards. Idempotent: run it again and rows are updated in place; an
 * existing fragrance keeps its aliases, flags, prices, markdowns and concentrate (the importer's
 * `seed` mode).
 */
export const PLACEHOLDER_PRICES = { 10: 69_000, 30: 149_000, 50: 219_000 } as const;
/** Each fragrance's ready concentrate in the seed (ADR 0043): ours, like the prices. */
export const PLACEHOLDER_CONCENTRATE_ML = 1000;
export const PLACEHOLDER_DISCOVERY_ON_HAND = 10;
/** Customer, 2026-11-07: «до 24 часов» for every fragrance, whatever the guide says. */
export const LONGEVITY = { ru: 'до 24 часов', uz: '24 soatgacha' } as const;
export const SEED_WORKBOOK = fileURLToPath(
  new URL('../../seed/LUMMI_Katalog.xlsx', import.meta.url),
);

/**
 * Spelling variants (aliases) for names whose Cyrillic or phonetic reading does not follow from
 * the Latin spelling (French and English). Provisional: the customer's list and the admin panel
 * replace them. They live in the seed workbook's «Псевдонимы» column; this is how it was filled.
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
};

export interface SeedOptions {
  /** `materials/` of the repo (read-only); the bottle photos are read from `flakons/`. */
  materialsDir: string;
  /** With a store, the bottle photos go through the pipeline; without, volumes get no photo. */
  photos?: FileStore;
  /** Only the first N fragrances of the workbook (tests). */
  limit?: number;
  /** Another workbook in the template (tests); default is the committed seed. */
  workbook?: string;
  /**
   * Only the workbook's fragrances whose code the catalog does not have yet (and the families and
   * notes it does not have): how fragrances added to the seed later (068–082) reach a catalog that
   * already has data, without touching anything there. No Discovery set or consumables step.
   */
  onlyMissing?: boolean;
}

/**
 * Each Discovery set (ADR 0009, 0042) starts as the first five fragrances with 10 boxes in stock,
 * both ours (the composition is the owner's to choose, the boxes his to count). Only while the
 * owner has not set that set's composition, so a re-run never undoes his choice; the boxes only
 * onto a row still flagged `is_placeholder` (the migration flags both), so ours never reach launch
 * unmarked.
 */
async function seedDiscoverySet(tx: DbOrTx, fragranceIds: number[]): Promise<void> {
  if (fragranceIds.length < SET_SIZE) return;
  // the two the migrations insert; the owner's own sets (ADR 0044) are never seeded
  for (const key of [MAIN_SET_KEY, FIVE_ML_SET_KEY]) {
    const [has] = await tx
      .select()
      .from(discoverySetItems)
      .where(eq(discoverySetItems.setKey, key))
      .limit(1);
    if (has) continue;
    await tx.insert(discoverySetItems).values(
      fragranceIds.slice(0, SET_SIZE).map((fragranceId, i) => ({
        setKey: key,
        position: i + 1,
        fragranceId,
      })),
    );
    await tx
      .update(discoverySet)
      .set({ onHand: PLACEHOLDER_DISCOVERY_ON_HAND, isPlaceholder: true })
      .where(
        and(
          eq(discoverySet.key, key),
          eq(discoverySet.onHand, 0),
          eq(discoverySet.isPlaceholder, true),
        ),
      );
  }
}

/** Bottles of each volume per fragrance the placeholder flacons and boxes stand for (the old seed's count). */
export const PLACEHOLDER_BOTTLES_PER_VOLUME = 20;

/**
 * The consumables' placeholder counts (ADR 0043), consistent with the seeded concentrate: a flacon
 * and a box of each ml for `PLACEHOLDER_BOTTLES_PER_VOLUME` bottles per fragrance, and the spirit
 * to mix each fragrance's `PLACEHOLDER_CONCENTRATE_ML` once more at the default shares. Only onto
 * an item still flagged ours and never counted (0), as the Discovery set's boxes (#79): a re-run
 * never overwrites the owner's number, and ours never reach launch unmarked.
 */
async function seedConsumables(tx: DbOrTx): Promise<void> {
  const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(fragrances);
  const spirit = Math.round(
    mixNeeds(PLACEHOLDER_CONCENTRATE_ML, defaultCostSettings().liquid).ethanolMl,
  );
  await tx
    .update(consumables)
    .set({
      onHand: sql`case when ${consumables.use} = 'ethanol' then ${n * spirit}::int else ${
        n * PLACEHOLDER_BOTTLES_PER_VOLUME
      }::int end`,
    })
    .where(
      and(
        eq(consumables.isPlaceholder, true),
        eq(consumables.onHand, 0),
        inArray(consumables.use, ['flacon', 'box', 'ethanol']),
      ),
    );
}

export async function seedCatalog(db: Db, opts: SeedOptions): Promise<{ fragrances: number }> {
  const bytes = await readFile(opts.workbook ?? SEED_WORKBOOK);
  const raw = await readWorkbook(bytes, { maxRows: 100_000 });
  if (opts.limit !== undefined) {
    const keep = new Set(
      raw.fragrances.slice(0, opts.limit).map((r) => normaliseCode(r.cells.code)),
    );
    raw.fragrances = raw.fragrances.filter((r) => keep.has(normaliseCode(r.cells.code)));
    raw.volumes = raw.volumes.filter((r) => keep.has(normaliseCode(r.cells.code)));
    // curated similar fragrances inside the kept ones only
    for (const r of raw.fragrances) {
      r.cells.similar = r.cells.similar
        .split(/[,;]/)
        .filter((c) => keep.has(normaliseCode(c)))
        .join(', ');
    }
  }

  if (opts.onlyMissing) {
    const have = new Set(
      (await db.select({ code: fragrances.code }).from(fragrances)).map((f) => f.code),
    );
    const missing = (c: string) => !have.has(normaliseCode(c) ?? c);
    raw.fragrances = raw.fragrances.filter((r) => missing(r.cells.code));
    raw.volumes = raw.volumes.filter((r) => missing(r.cells.code));
    if (!raw.fragrances.length) return { fragrances: 0 };
    const known = async (table: typeof families | typeof notes) =>
      new Set((await db.select({ n: table.nameRu }).from(table)).map((r) => r.n.toLowerCase()));
    const fam = await known(families);
    const nts = await known(notes);
    raw.families = raw.families.filter((r) => !fam.has(r.cells.nameRu.trim().toLowerCase()));
    raw.notes = raw.notes.filter((r) => !nts.has(r.cells.nameRu.trim().toLowerCase()));
  }

  const clock = new SystemClock();
  const audit = new AuditService();
  const admin = new CatalogAdminService(db, { clock } as unknown as Edges, audit);
  const importer = new CatalogImportService(db, { clock }, audit, admin);
  const res = await importer.applyRaw(
    null,
    raw,
    createHash('sha256').update(bytes).digest('hex'),
    null,
    { seed: true },
  );
  if (!res.ok) {
    const issues = res.reason === 'invalid' ? res.report.errors : [];
    throw new Error(
      `seed workbook rejected: ${issues
        .slice(0, 5)
        .map((i) => `${i.sheet} row ${i.row} ${i.column ?? ''} ${i.code}`)
        .join('; ')}`,
    );
  }

  // Photos last (slow): slug -> ml -> hash, onto the volumes the import just wrote.
  if (opts.photos) {
    for (const r of raw.fragrances) {
      const slug = slugify(r.cells.name);
      for (const ml of [10, 30, 50]) {
        const file = join(opts.materialsDir, `flakons/${slug}_${ml}ml.webp`);
        // the customer's later additions (068–082) come without bottle photos yet: no photo
        // until he sends them or the admin uploads one
        if (!existsSync(file)) continue;
        const { hash } = await storePhoto(opts.photos, await readFile(file));
        const [f] = await db
          .select({ id: fragrances.id })
          .from(fragrances)
          .where(eq(fragrances.slug, slug));
        if (f) {
          await db
            .update(volumes)
            .set({ photoHash: hash })
            .where(and(eq(volumes.fragranceId, f.id), eq(volumes.ml, ml)));
        }
      }
    }
  }
  if (opts.onlyMissing) return { fragrances: raw.fragrances.length };
  // Discovery set (#22): outside the workbook, by the first five fragrances in workbook order.
  const first = await db
    .select({ id: fragrances.id })
    .from(fragrances)
    .orderBy(asc(fragrances.id))
    .limit(SET_SIZE);
  await db.transaction((tx) =>
    seedDiscoverySet(
      tx,
      first.map((f) => f.id),
    ),
  );
  await db.transaction((tx) => seedConsumables(tx));
  return { fragrances: raw.fragrances.length };
}

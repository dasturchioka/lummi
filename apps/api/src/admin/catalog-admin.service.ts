import type {
  DictionaryInput,
  DictionaryItem,
  FragranceAdmin,
  FragranceCosts,
  FragranceInput,
  AdminFragranceListItem,
  VolumeInput,
} from '@lummi/contracts';
import { tashkentToUtc, utcToTashkent } from '@lummi/contracts';
import { NOT_SOLD_ALONE_ML } from '@lummi/contracts/constants';
import {
  and,
  asc,
  eq,
  families,
  fragranceNotes,
  fragranceSimilar,
  fragrances,
  inArray,
  notes,
  sellableVolume,
  sql,
  volumes,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { normalizeUzbek } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { belowReserve, readLiquidStock } from '../catalog/catalog.service';
import { readCostSettings } from '../cost/cost-settings';
import { fragranceCosts } from '../cost/fragrance-costs';
import { readSettings } from '../settings/settings.service';
import { reindexFragrances } from '../search/search-index';
import { storeUploadedPhoto } from '../catalog/photo-pipeline';
import { slugify } from '../catalog/slug';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { apostropheLike, withoutApostrophes } from '../util/apostrophe-match';
import { retryOrTryAgain } from '../util/transient';
import { mlFromUl, ulFromMl } from '../warehouse/oil';
import { recordStockMove } from '../warehouse/stock-moves';
import { lockFragrances } from '../warehouse/stock-changes';

export type Failure = {
  ok: false;
  reason: 'not_found' | 'conflict' | 'invalid' | 'concentrate_changed' | 'try_again';
  fields?: string[];
};
export type Outcome<T> = { ok: true; value: T } | Failure;
const fail = (reason: Failure['reason'], fields?: string[]): Failure => ({
  ok: false,
  reason,
  fields,
});

/**
 * A transaction that locks the fragrance row, retried once on a deadlock or serialization failure
 * (checkout and the handover lock the same rows); a second one is the clean `try_again` instead of
 * a 500.
 */
const transient = <T>(run: () => Promise<Outcome<T>>): Promise<Outcome<T>> =>
  retryOrTryAgain(run, fail('try_again'));

/** 23505, whether Drizzle wrapped the driver error or not. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } }) ?? {};
  return code.code === '23505' || code.cause?.code === '23505';
}

/** Advisory lock that serialises handing out internal product codes. */
const PRODUCT_CODE_LOCK = 1701;
const emptyToNull = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());
const pad = (n: number) => String(n).padStart(2, '0');

/** Uzbek texts and aliases are normalised on every save (ADR 0018). Names and brands are left alone. */
export function normalise(input: FragranceInput): FragranceInput {
  return {
    ...input,
    longevityUz: normalizeUzbek(input.longevityUz),
    descriptionUz: normalizeUzbek(input.descriptionUz),
    whenToWearUz: normalizeUzbek(input.whenToWearUz),
    keyNotesUz: input.keyNotesUz.map(normalizeUzbek),
    aliases: [...new Set(input.aliases.map(normalizeUzbek))],
  };
}

/** The end of a markdown's last day: 23:59:59 Asia/Tashkent (spec Changes 2026-11-09). */
export function saleEndInstant(day: string): Date | null {
  const [y, m, d] = day.split('-').map(Number);
  return tashkentToUtc({ year: y!, month: m!, day: d!, hour: 23, minute: 59, second: 59 });
}
export function saleEndDay(at: Date | null): string | null {
  if (!at) return null;
  const t = utcToTashkent(at);
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

@Injectable()
export class CatalogAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---- fragrances ----

  async list(query: {
    q?: string;
    type?: FragranceInput['type'];
    familyId?: number;
    visibility?: 'visible' | 'hidden';
    flag?: 'hit' | 'new';
  }): Promise<AdminFragranceListItem[]> {
    const where = [];
    if (query.q) {
      // apostrophes are ignored on both sides: «Devil's» finds «Devil’s Intrigue» and the reverse
      const like = apostropheLike(query.q);
      where.push(
        sql`(${withoutApostrophes(fragrances.name)} ilike ${like} or ${withoutApostrophes(fragrances.originalBrand)} ilike ${like}
          or ${fragrances.code} ilike ${like}
          or exists (select 1 from unnest(${fragrances.aliases}) a where ${withoutApostrophes(sql`a`)} ilike ${like}))`,
      );
    }
    if (query.type) where.push(eq(fragrances.type, query.type));
    if (query.familyId) where.push(eq(fragrances.familyId, query.familyId));
    if (query.visibility) where.push(eq(fragrances.hidden, query.visibility === 'hidden'));
    if (query.flag)
      where.push(eq(query.flag === 'hit' ? fragrances.isHit : fragrances.isNew, true));

    const rows = await this.db
      .select({
        id: fragrances.id,
        slug: fragrances.slug,
        code: fragrances.code,
        name: fragrances.name,
        originalBrand: fragrances.originalBrand,
        type: fragrances.type,
        familyRu: families.nameRu,
        familyUz: families.nameUz,
        isHit: fragrances.isHit,
        isNew: fragrances.isNew,
        hidden: fragrances.hidden,
      })
      .from(fragrances)
      .leftJoin(families, eq(families.id, fragrances.familyId))
      .where(and(...where))
      .orderBy(asc(sql`lower(${fragrances.name})`), asc(fragrances.id));
    if (rows.length === 0) return [];
    const stock = await readLiquidStock(
      this.db,
      rows.map((r) => r.id),
    );
    const vols = await this.db
      .select()
      .from(volumes)
      .where(
        and(
          inArray(
            volumes.fragranceId,
            rows.map((r) => r.id),
          ),
          // the form's volumes: the 5 ml has no price and is filled for samples and sets (ADR 0042)
          sellableVolume(),
        ),
      )
      .orderBy(asc(volumes.ml));
    return rows.map((r) => {
      const mine = vols.filter((v) => v.fragranceId === r.id);
      return {
        ...r,
        photo: mine.find((v) => v.photoHash)?.photoHash ?? null,
        volumes: mine.map((v) => ({
          ml: v.ml,
          price: v.price,
          salePrice: v.salePrice,
          available: stock.bottles(r.id, v.ml),
          photo: v.photoHash,
        })),
        concentrateMl: mlFromUl(stock.of(r.id).concentrateUl),
      };
    });
  }

  async get(id: number, db: DbOrTx = this.db): Promise<FragranceAdmin | null> {
    const [f] = await db.select().from(fragrances).where(eq(fragrances.id, id));
    if (!f) return null;
    const [noteRows, similarRows, volumeRows] = await Promise.all([
      db
        .select()
        .from(fragranceNotes)
        .where(eq(fragranceNotes.fragranceId, id))
        .orderBy(asc(fragranceNotes.position)),
      db
        .select()
        .from(fragranceSimilar)
        .where(eq(fragranceSimilar.fragranceId, id))
        .orderBy(asc(fragranceSimilar.position)),
      db
        .select()
        .from(volumes)
        .where(and(eq(volumes.fragranceId, id), sellableVolume()))
        .orderBy(asc(volumes.ml)),
    ]);
    const stock = await readLiquidStock(db, [id]);
    const liquid = stock.of(id);
    const shownCfg = await readSettings(db, ['stock.shownDefault', 'stock.shownMax']);
    const level = (l: 'top' | 'heart' | 'base') =>
      noteRows.filter((n) => n.level === l).map((n) => n.noteId);
    return {
      id: f.id,
      slug: f.slug,
      code: f.code,
      name: f.name,
      originalBrand: f.originalBrand,
      type: f.type,
      familyId: f.familyId,
      season: f.season,
      timeOfDay: f.timeOfDay,
      sillage: f.sillage,
      longevityRu: f.longevityRu,
      longevityUz: f.longevityUz,
      descriptionRu: f.descriptionRu,
      descriptionUz: f.descriptionUz,
      whenToWearRu: f.whenToWearRu,
      whenToWearUz: f.whenToWearUz,
      keyNotesRu: f.keyNotesRu,
      keyNotesUz: f.keyNotesUz,
      internalRemark: f.internalRemark,
      aliases: f.aliases,
      uzumUrl: f.uzumUrl,
      oilPrice: f.oilPrice,
      tier: f.tier,
      oilSupplier: f.oilSupplier,
      oilInvoice: f.oilInvoice,
      isHit: f.isHit,
      isNew: f.isNew,
      hidden: f.hidden,
      notes: { top: level('top'), heart: level('heart'), base: level('base') },
      shownCount: f.shownCount,
      shownDefault: shownCfg['stock.shownDefault'],
      shownMax: shownCfg['stock.shownMax'],
      similarIds: similarRows.map((s) => s.similarId),
      volumes: volumeRows.map((v) => ({
        id: v.id,
        ml: v.ml as 10 | 30 | 50,
        price: v.price,
        salePrice: v.salePrice,
        saleEndsOn: saleEndDay(v.saleEndsAt),
        available: stock.bottles(id, v.ml),
        photo: v.photoHash,
        isPlaceholder: v.isPlaceholder,
      })),
      stock: {
        concentrateMl: mlFromUl(liquid.concentrateUl),
        reservedMl: mlFromUl(liquid.reservedUl),
        belowReserve: belowReserve(liquid.concentrateUl, liquid.reservedUl),
      },
    };
  }

  /** Each volume's unit cost from the saved oil price and the cost settings (ADR 0040); null: no such fragrance. */
  async costs(id: number): Promise<FragranceCosts | null> {
    const [f] = await this.db
      .select({ oilPrice: fragrances.oilPrice })
      .from(fragrances)
      .where(eq(fragrances.id, id));
    if (!f) return null;
    const vols = await this.db
      .select()
      .from(volumes)
      // price against cost: the 5 ml has no price (ADR 0042)
      .where(and(eq(volumes.fragranceId, id), sellableVolume()))
      .orderBy(asc(volumes.ml));
    return fragranceCosts(f.oilPrice, vols, await readCostSettings(this.db), this.edges.clock.now());
  }

  async create(actor: StaffRow, raw: FragranceInput): Promise<Outcome<FragranceAdmin>> {
    const input = normalise(raw);
    try {
      return await this.db.transaction((tx) => this.createWithin(tx, actor, input));
    } catch (e) {
      if (isUniqueViolation(e)) return fail('conflict', ['name']);
      throw e;
    }
  }

  /**
   * The create, inside the caller's transaction (the Excel import runs many in one). `input` is
   * already normalised. Without `opts.code` the next free code is handed out under the code lock;
   * the import passes the code from the file. A null actor (the seed) writes no audit entry.
   */
  async createWithin(
    tx: DbOrTx,
    actor: StaffRow | null,
    input: FragranceInput,
    opts: { code?: string; source?: 'import'; placeholder?: boolean } = {},
  ): Promise<Outcome<FragranceAdmin>> {
    const slug = slugify(input.name);
    if (!slug) return fail('invalid', ['name']);
    const bad = await this.checkReferences(tx, input, null);
    if (bad.length) return fail('invalid', bad);
    // Codes are handed out one after another; the lock keeps two creates from taking the same.
    await tx.execute(sql`select pg_advisory_xact_lock(${PRODUCT_CODE_LOCK})`);
    let code = opts.code;
    if (!code) {
      const [{ next }] = (
        await tx.execute<{ next: number }>(
          sql`select coalesce(max(code::int), 0) + 1 as next from fragrances where code ~ '^[0-9]+$'`,
        )
      ).rows as [{ next: number }];
      code = String(next).padStart(3, '0');
    }
    const concentrateUl = ulFromMl(input.concentrateMl ?? 0);
    const [row] = await tx
      .insert(fragrances)
      .values({ ...this.columns(input), slug, code, concentrateUl })
      .returning({ id: fragrances.id });
    const id = row!.id;
    await this.writeLinks(tx, id, input);
    for (const v of input.volumes) await this.insertVolume(tx, id, v, opts.placeholder);
    // the 5 ml bottle (ADR 0042): filled for the 5 × 5 ml set and the gift sample, never sold, so
    // it has no price and no place in the form
    await tx.insert(volumes).values({ fragranceId: id, ml: NOT_SOLD_ALONE_ML, price: 0 });
    // the first count is a correction from the form or the import (#76, #82); the seed writes none
    if (actor) await this.recordFormCount(tx, actor, id, 0, concentrateUl, opts.source);
    await reindexFragrances(tx, [id]);
    if (actor) {
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'catalog.fragrance_created',
        targetType: 'fragrance',
        targetId: id,
        payload: {
          name: input.name,
          slug,
          code,
          hidden: input.hidden,
          ...(opts.source ? { source: opts.source } : {}),
        },
      });
    }
    return { ok: true, value: (await this.get(id, tx))! } as const;
  }

  async update(actor: StaffRow, id: number, raw: FragranceInput): Promise<Outcome<FragranceAdmin>> {
    const input = normalise(raw);
    return transient(() => this.db.transaction((tx) => this.updateWithin(tx, actor, id, input)));
  }

  /** The update, inside the caller's transaction; `input` is already normalised. Null actor: no audit. */
  async updateWithin(
    tx: DbOrTx,
    actor: StaffRow | null,
    id: number,
    input: FragranceInput,
    opts: { source?: 'import' } = {},
  ): Promise<Outcome<FragranceAdmin>> {
    // The fragrance row is locked before its concentrate is read: a count made meanwhile (a
    // manager's, a mixing, the BTS handover's) is either seen here or waits for this save.
    const [locked] = await tx
      .select({ id: fragrances.id, concentrateUl: fragrances.concentrateUl })
      .from(fragrances)
      .where(eq(fragrances.id, id))
      .for('update');
    if (!locked) return fail('not_found');
    const bad = await this.checkReferences(tx, input, id);
    if (bad.length) return fail('invalid', bad);
    const before = (await this.get(id, tx))!;
    // The concentrate is compare-and-set (ADR 0043): the owner's form carries the count it loaded;
    // a changed count is written only if the stored one still equals it. Nothing is written otherwise.
    const counted = this.concentrateEdited(input);
    if (counted !== null && locked.concentrateUl !== ulFromMl(input.loadedConcentrateMl!))
      return fail('concentrate_changed', ['concentrateMl']);

    await tx
      .update(fragrances)
      .set({
        ...this.columns(input),
        ...(counted !== null ? { concentrateUl: counted } : {}),
        updatedAt: this.edges.clock.now(),
      })
      .where(eq(fragrances.id, id));
    await tx.delete(fragranceNotes).where(eq(fragranceNotes.fragranceId, id));
    await tx.delete(fragranceSimilar).where(eq(fragranceSimilar.fragranceId, id));
    await this.writeLinks(tx, id, input);
    const volumeChanges: Record<string, unknown>[] = [];
    for (const v of input.volumes) {
      const old = before.volumes.find((x) => x.ml === v.ml);
      if (!old) {
        await this.insertVolume(tx, id, v);
        volumeChanges.push({ ml: v.ml, added: true, price: v.price });
        continue;
      }
      const end = v.saleEndsOn ? saleEndInstant(v.saleEndsOn) : null;
      await tx
        .update(volumes)
        .set({
          price: v.price,
          salePrice: v.salePrice,
          saleEndsAt: end,
          ...(old.price !== v.price ? { isPlaceholder: false } : {}),
        })
        .where(eq(volumes.id, old.id));
      const diff = this.volumeDiff(old, v);
      if (diff) volumeChanges.push({ ml: v.ml, ...diff });
    }
    if (actor && counted !== null)
      await this.recordFormCount(tx, actor, id, locked.concentrateUl, counted, opts.source);

    await reindexFragrances(tx, [id]);
    const after = (await this.get(id, tx))!;
    const changed = (Object.keys(after) as (keyof FragranceAdmin)[]).filter(
      (k) =>
        k !== 'volumes' && k !== 'stock' && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    if (actor) {
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'catalog.fragrance_updated',
        targetType: 'fragrance',
        targetId: id,
        payload: {
          name: after.name,
          changed,
          volumes: volumeChanges,
          ...(counted !== null && counted !== locked.concentrateUl
            ? { concentrateMl: [mlFromUl(locked.concentrateUl), mlFromUl(counted)] }
            : {}),
          ...(opts.source ? { source: opts.source } : {}),
        },
      });
    }
    return { ok: true, value: after } as const;
  }

  async setHidden(actor: StaffRow, id: number, hidden: boolean): Promise<Outcome<FragranceAdmin>> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(fragrances)
        .set({ hidden, updatedAt: this.edges.clock.now() })
        .where(eq(fragrances.id, id))
        .returning({ id: fragrances.id, name: fragrances.name });
      if (!updated) return fail('not_found');
      await reindexFragrances(tx, [id]);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: hidden ? 'catalog.fragrance_hidden' : 'catalog.fragrance_unhidden',
        targetType: 'fragrance',
        targetId: id,
        payload: { name: updated.name },
      });
      return { ok: true, value: (await this.get(id, tx))! } as const;
    });
  }

  /**
   * #83: the number the shop shows customers for this fragrance (null = the default). The top is the
   * setting `stock.shownMax`, so it is checked here, not in the database. Audited with the actor.
   */
  async setShownCount(
    actor: StaffRow,
    id: number,
    shownCount: number | null,
  ): Promise<Outcome<FragranceAdmin>> {
    const { 'stock.shownMax': max } = await readSettings(this.db, ['stock.shownMax']);
    if (shownCount !== null && (shownCount < 1 || shownCount > max))
      return fail('invalid', ['shownCount']);
    return this.db.transaction(async (tx) => {
      const [old] = await tx
        .select({ name: fragrances.name, shownCount: fragrances.shownCount })
        .from(fragrances)
        .where(eq(fragrances.id, id))
        .for('update');
      if (!old) return fail('not_found');
      if (old.shownCount !== shownCount) {
        await tx
          .update(fragrances)
          .set({ shownCount, updatedAt: this.edges.clock.now() })
          .where(eq(fragrances.id, id));
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'catalog.shown_count_changed',
          targetType: 'fragrance',
          targetId: id,
          payload: { name: old.name, shownCount: [old.shownCount, shownCount] },
        });
      }
      return { ok: true, value: (await this.get(id, tx))! } as const;
    });
  }

  private columns(i: FragranceInput) {
    return {
      name: i.name,
      originalBrand: i.originalBrand,
      type: i.type,
      familyId: i.familyId,
      season: i.season,
      timeOfDay: i.timeOfDay,
      sillage: i.sillage,
      longevityRu: i.longevityRu,
      longevityUz: i.longevityUz,
      descriptionRu: i.descriptionRu,
      descriptionUz: i.descriptionUz,
      whenToWearRu: i.whenToWearRu,
      whenToWearUz: i.whenToWearUz,
      keyNotesRu: i.keyNotesRu,
      keyNotesUz: i.keyNotesUz,
      internalRemark: emptyToNull(i.internalRemark),
      aliases: i.aliases,
      uzumUrl: emptyToNull(i.uzumUrl),
      oilPrice: i.oilPrice,
      tier: i.tier,
      oilSupplier: emptyToNull(i.oilSupplier),
      oilInvoice: emptyToNull(i.oilInvoice),
      isHit: i.isHit,
      isNew: i.isNew,
      hidden: i.hidden,
    };
  }

  private async writeLinks(tx: DbOrTx, id: number, i: FragranceInput) {
    const links = (['top', 'heart', 'base'] as const).flatMap((level) =>
      i.notes[level].map((noteId, position) => ({ fragranceId: id, noteId, level, position })),
    );
    if (links.length) await tx.insert(fragranceNotes).values(links);
    await this.writeSimilar(tx, id, i.similarIds);
  }

  private async writeSimilar(tx: DbOrTx, id: number, similarIds: number[]) {
    if (!similarIds.length) return;
    await tx
      .insert(fragranceSimilar)
      .values(similarIds.map((similarId, position) => ({ fragranceId: id, similarId, position })));
  }

  /** True when a similar id is the fragrance itself or does not exist. */
  private async similarBad(tx: DbOrTx, ids: number[], selfId: number | null): Promise<boolean> {
    if (!ids.length) return false;
    if (selfId !== null && ids.includes(selfId)) return true;
    const found = await tx
      .select({ id: fragrances.id })
      .from(fragrances)
      .where(inArray(fragrances.id, ids));
    return found.length !== ids.length;
  }

  /**
   * Links a new fragrance to the similar ones the import names (they may be created in the same
   * file, so they are known only after the first pass), with the form's own checks. False: refused.
   */
  async linkSimilarWithin(tx: DbOrTx, id: number, similarIds: number[]): Promise<boolean> {
    if (await this.similarBad(tx, similarIds, id)) return false;
    await this.writeSimilar(tx, id, similarIds);
    return true;
  }

  private async insertVolume(tx: DbOrTx, fragranceId: number, v: VolumeInput, placeholder = false) {
    await tx.insert(volumes).values({
      isPlaceholder: placeholder,
      fragranceId,
      ml: v.ml,
      price: v.price,
      salePrice: v.salePrice,
      saleEndsAt: v.saleEndsOn ? saleEndInstant(v.saleEndsOn) : null,
    });
  }

  /**
   * A concentrate count the form or the import made, as one correction in the fragrance's history
   * (#76, #82); none when it did not move.
   */
  private async recordFormCount(
    tx: DbOrTx,
    actor: StaffRow,
    fragranceId: number,
    fromUl: number,
    toUl: number,
    source: 'import' | undefined,
  ) {
    if (fromUl === toUl) return;
    await recordStockMove(tx, {
      fragranceId,
      kind: 'correction',
      actor: { type: 'staff', id: actor.id },
      concentrateUl: toUl - fromUl,
      details: { source: source ?? 'form' },
    });
  }

  /**
   * The concentrate the owner typed, µl, when it differs from the one the form loaded (on an
   * existing fragrance); null: not written.
   */
  private concentrateEdited(input: FragranceInput): number | null {
    if (input.concentrateMl === undefined || input.loadedConcentrateMl == null) return null;
    const typed = ulFromMl(input.concentrateMl);
    return typed === ulFromMl(input.loadedConcentrateMl) ? null : typed;
  }

  private volumeDiff(old: FragranceAdmin['volumes'][number], v: VolumeInput) {
    const out: Record<string, [unknown, unknown]> = {};
    if (old.price !== v.price) out.price = [old.price, v.price];
    if (old.salePrice !== v.salePrice) out.salePrice = [old.salePrice, v.salePrice];
    if (old.saleEndsOn !== v.saleEndsOn) out.saleEndsOn = [old.saleEndsOn, v.saleEndsOn];
    return Object.keys(out).length ? out : null;
  }

  /** Ids that must exist and dates that must be real; returns the failing field paths. */
  private async checkReferences(tx: DbOrTx, i: FragranceInput, selfId: number | null) {
    const bad: string[] = [];
    if (i.familyId !== null) {
      const [f] = await tx
        .select({ id: families.id })
        .from(families)
        .where(eq(families.id, i.familyId));
      if (!f) bad.push('familyId');
    }
    const noteIds = [...i.notes.top, ...i.notes.heart, ...i.notes.base];
    if (noteIds.length) {
      const found = await tx.select({ id: notes.id }).from(notes).where(inArray(notes.id, noteIds));
      const have = new Set(found.map((n) => n.id));
      for (const level of ['top', 'heart', 'base'] as const) {
        if (i.notes[level].some((n) => !have.has(n))) bad.push(`notes.${level}`);
      }
    }
    if (await this.similarBad(tx, i.similarIds, selfId)) bad.push('similarIds');
    i.volumes.forEach((v, n) => {
      if (v.saleEndsOn && !saleEndInstant(v.saleEndsOn)) bad.push(`volumes.${n}.saleEndsOn`);
    });
    return bad;
  }

  // ---- dictionaries ----

  async listDictionary(
    kind: 'families' | 'notes',
    db: DbOrTx = this.db,
  ): Promise<DictionaryItem[]> {
    const table = kind === 'families' ? families : notes;
    const rows = await db
      .select()
      .from(table)
      .orderBy(asc(sql`lower(${table.nameRu})`));
    const uses =
      kind === 'families'
        ? await db
            .select({ id: fragrances.familyId, n: sql<number>`count(*)::int` })
            .from(fragrances)
            .groupBy(fragrances.familyId)
        : await db
            .select({
              id: fragranceNotes.noteId,
              n: sql<number>`count(distinct ${fragranceNotes.fragranceId})::int`,
            })
            .from(fragranceNotes)
            .groupBy(fragranceNotes.noteId);
    const count = new Map(uses.map((u) => [u.id, u.n]));
    return rows.map((r) => ({
      id: r.id,
      nameRu: r.nameRu,
      nameUz: r.nameUz,
      aliases: r.aliases,
      uses: count.get(r.id) ?? 0,
    }));
  }

  async saveDictionary(
    actor: StaffRow,
    kind: 'families' | 'notes',
    id: number | null,
    raw: DictionaryInput,
  ): Promise<Outcome<DictionaryItem>> {
    try {
      return await this.db.transaction((tx) => this.saveDictionaryWithin(tx, actor, kind, id, raw));
    } catch (e) {
      if (isUniqueViolation(e)) return fail('conflict', ['nameRu']);
      throw e;
    }
  }

  /** The dictionary save inside the caller's transaction (the Excel import uses it); null actor: no audit. */
  async saveDictionaryWithin(
    tx: DbOrTx,
    actor: StaffRow | null,
    kind: 'families' | 'notes',
    id: number | null,
    raw: DictionaryInput,
  ): Promise<Outcome<DictionaryItem>> {
    const table = kind === 'families' ? families : notes;
    const values = {
      nameRu: raw.nameRu,
      nameUz: normalizeUzbek(raw.nameUz),
      aliases: [...new Set(raw.aliases.map(normalizeUzbek))],
    };
    const target = kind === 'families' ? 'family' : 'note';
    let rowId = id;
    if (id === null) {
      const [row] = await tx.insert(table).values(values).returning({ id: table.id });
      rowId = row!.id;
    } else {
      const [row] = await tx
        .update(table)
        .set(values)
        .where(eq(table.id, id))
        .returning({ id: table.id });
      if (!row) return fail('not_found');
    }
    if (id !== null) {
      // every fragrance that shows this note or family is searchable by its new name
      const used =
        kind === 'families'
          ? await tx
              .select({ id: fragrances.id })
              .from(fragrances)
              .where(eq(fragrances.familyId, id))
          : await tx
              .select({ id: fragranceNotes.fragranceId })
              .from(fragranceNotes)
              .where(eq(fragranceNotes.noteId, id))
              .groupBy(fragranceNotes.fragranceId);
      await reindexFragrances(
        tx,
        used.map((u) => u.id),
      );
    }
    if (actor) {
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: `catalog.${target}_${id === null ? 'created' : 'updated'}`,
        targetType: target,
        targetId: rowId,
        payload: values,
      });
    }
    const item = (await this.listDictionary(kind, tx)).find((d) => d.id === rowId)!;
    return { ok: true, value: item } as const;
  }

  // ---- photos ----

  /** Runs the upload through the WebP pipeline (the original bytes are kept) and points the volume at it. */
  async setPhoto(actor: StaffRow, volumeId: number, bytes: Uint8Array): Promise<Outcome<string>> {
    const [exists] = await this.db
      .select({ id: volumes.id })
      .from(volumes)
      .where(eq(volumes.id, volumeId));
    if (!exists) return fail('not_found');
    // magic bytes and the minimum size (the 400 px rendition must not be an upscale) live in one place
    const stored = await storeUploadedPhoto(this.edges.files, bytes);
    if (!stored) return fail('invalid', ['photo']);
    const hash = stored.hash;
    return this.db.transaction(async (tx) => {
      // read the previous photo under the lock, so the audit pair is never stale
      const [old] = await tx.select().from(volumes).where(eq(volumes.id, volumeId)).for('update');
      if (!old) return fail('not_found');
      await tx.update(volumes).set({ photoHash: hash }).where(eq(volumes.id, volumeId));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'catalog.photo_uploaded',
        targetType: 'volume',
        targetId: volumeId,
        payload: { ml: old.ml, fragranceId: old.fragranceId, photo: [old.photoHash, hash] },
      });
      return { ok: true, value: hash } as const;
    });
  }
}

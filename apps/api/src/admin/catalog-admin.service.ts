import type {
  DictionaryInput,
  DictionaryItem,
  FragranceAdmin,
  FragranceInput,
  AdminFragranceListItem,
  OnHandItem,
  VolumeInput,
} from '@lummi/contracts';
import { tashkentToUtc, utcToTashkent } from '@lummi/contracts';
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
  sql,
  volumes,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { APOSTROPHE_CLASS, normalizeUzbek, stripApostrophes } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { available, reservedByVolume } from '../catalog/catalog.service';
import { reindexFragrances } from '../search/search-index';
import { storeUploadedPhoto } from '../catalog/photo-pipeline';
import { slugify } from '../catalog/slug';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

export type Failure = {
  ok: false;
  reason: 'not_found' | 'conflict' | 'invalid' | 'on_hand_changed';
  fields?: string[];
};
export type Outcome<T> = { ok: true; value: T } | Failure;
const fail = (reason: Failure['reason'], fields?: string[]): Failure => ({
  ok: false,
  reason,
  fields,
});

/** 23505, whether Drizzle wrapped the driver error or not. */
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } }) ?? {};
  return code.code === '23505' || code.cause?.code === '23505';
}

/** Advisory lock that serialises handing out internal product codes. */
const PRODUCT_CODE_LOCK = 1701;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const emptyToNull = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());
const pad = (n: number) => String(n).padStart(2, '0');

/** Uzbek texts and aliases are normalised on every save (ADR 0018). Names and brands are left alone. */
function normalise(input: FragranceInput): FragranceInput {
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
function saleEndInstant(day: string): Date | null {
  const [y, m, d] = day.split('-').map(Number);
  return tashkentToUtc({ year: y!, month: m!, day: d!, hour: 23, minute: 59, second: 59 });
}
function saleEndDay(at: Date | null): string | null {
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
      const like = `%${escapeLike(stripApostrophes(normalizeUzbek(query.q)))}%`;
      const plain = (col: unknown) => sql`regexp_replace(${col}, ${APOSTROPHE_CLASS}, '', 'g')`;
      where.push(
        sql`(${plain(fragrances.name)} ilike ${like} or ${plain(fragrances.originalBrand)} ilike ${like}
          or ${fragrances.code} ilike ${like}
          or exists (select 1 from unnest(${fragrances.aliases}) a where ${plain(sql`a`)} ilike ${like}))`,
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
    const vols = await this.db
      .select()
      .from(volumes)
      .where(
        inArray(
          volumes.fragranceId,
          rows.map((r) => r.id),
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
          onHand: v.onHand,
          photo: v.photoHash,
        })),
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
      db.select().from(volumes).where(eq(volumes.fragranceId, id)).orderBy(asc(volumes.ml)),
    ]);
    const reserved = await reservedByVolume(
      db,
      volumeRows.map((v) => v.id),
    );
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
      isHit: f.isHit,
      isNew: f.isNew,
      hidden: f.hidden,
      notes: { top: level('top'), heart: level('heart'), base: level('base') },
      similarIds: similarRows.map((s) => s.similarId),
      volumes: volumeRows.map((v) => ({
        id: v.id,
        ml: v.ml as 10 | 30 | 50,
        price: v.price,
        salePrice: v.salePrice,
        saleEndsOn: saleEndDay(v.saleEndsAt),
        onHand: v.onHand,
        reserved: reserved.get(v.id) ?? 0,
        belowReserve: v.onHand < (reserved.get(v.id) ?? 0),
        photo: v.photoHash,
        isPlaceholder: v.isPlaceholder,
      })),
    };
  }

  async create(actor: StaffRow, raw: FragranceInput): Promise<Outcome<FragranceAdmin>> {
    const input = normalise(raw);
    const slug = slugify(input.name);
    if (!slug) return fail('invalid', ['name']);
    try {
      return await this.db.transaction(async (tx) => {
        const bad = await this.checkReferences(tx, input, null);
        if (bad.length) return fail('invalid', bad);
        // Codes are handed out one after another; the lock keeps two creates from taking the same.
        await tx.execute(sql`select pg_advisory_xact_lock(${PRODUCT_CODE_LOCK})`);
        const [{ next }] = (
          await tx.execute<{ next: number }>(
            sql`select coalesce(max(code::int), 0) + 1 as next from fragrances where code ~ '^[0-9]+$'`,
          )
        ).rows as [{ next: number }];
        const code = String(next).padStart(3, '0');
        const [row] = await tx
          .insert(fragrances)
          .values({ ...this.columns(input), slug, code })
          .returning({ id: fragrances.id });
        const id = row!.id;
        await this.writeLinks(tx, id, input);
        for (const v of input.volumes) await this.insertVolume(tx, id, v);
        await reindexFragrances(tx, [id]);
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'catalog.fragrance_created',
          targetType: 'fragrance',
          targetId: id,
          payload: { name: input.name, slug, code, hidden: input.hidden },
        });
        return { ok: true, value: (await this.get(id, tx))! } as const;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail('conflict', ['name']);
      throw e;
    }
  }

  async update(actor: StaffRow, id: number, raw: FragranceInput): Promise<Outcome<FragranceAdmin>> {
    const input = normalise(raw);
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: fragrances.id })
        .from(fragrances)
        .where(eq(fragrances.id, id))
        .for('update');
      if (!locked) return fail('not_found');
      const bad = await this.checkReferences(tx, input, id);
      if (bad.length) return fail('invalid', bad);
      // The volume rows are locked before they are read: a count made meanwhile (a manager's, or
      // the BTS handover's) is either seen here or waits for this save (ADR 0010).
      await tx
        .select({ id: volumes.id })
        .from(volumes)
        .where(eq(volumes.fragranceId, id))
        .for('update');
      const before = (await this.get(id, tx))!;
      // On hand is compare-and-set: the owner's form carries the count it loaded; a changed
      // count is written only if the stored one still equals it. Nothing is written otherwise.
      for (const v of input.volumes) {
        const old = before.volumes.find((x) => x.ml === v.ml);
        if (old && this.onHandEdited(v) && old.onHand !== v.loadedOnHand) {
          return fail('on_hand_changed', [`volumes.${input.volumes.indexOf(v)}.onHand`]);
        }
      }

      await tx
        .update(fragrances)
        .set({ ...this.columns(input), updatedAt: this.edges.clock.now() })
        .where(eq(fragrances.id, id));
      await tx.delete(fragranceNotes).where(eq(fragranceNotes.fragranceId, id));
      await tx.delete(fragranceSimilar).where(eq(fragranceSimilar.fragranceId, id));
      await this.writeLinks(tx, id, input);
      const volumeChanges: Record<string, unknown>[] = [];
      for (const v of input.volumes) {
        const old = before.volumes.find((x) => x.ml === v.ml);
        if (!old) {
          await this.insertVolume(tx, id, v);
          volumeChanges.push({ ml: v.ml, added: true, price: v.price, onHand: v.onHand });
          continue;
        }
        const end = v.saleEndsOn ? saleEndInstant(v.saleEndsOn) : null;
        const writeOnHand = this.onHandEdited(v);
        const touched = old.price !== v.price || writeOnHand;
        await tx
          .update(volumes)
          .set({
            price: v.price,
            salePrice: v.salePrice,
            saleEndsAt: end,
            ...(writeOnHand ? { onHand: v.onHand } : {}),
            ...(touched ? { isPlaceholder: false } : {}),
          })
          .where(eq(volumes.id, old.id));
        const diff = this.volumeDiff(old, v, writeOnHand);
        if (diff) volumeChanges.push({ ml: v.ml, ...diff });
      }

      await reindexFragrances(tx, [id]);
      const after = (await this.get(id, tx))!;
      const changed = (Object.keys(after) as (keyof FragranceAdmin)[]).filter(
        (k) => k !== 'volumes' && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
      );
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'catalog.fragrance_updated',
        targetType: 'fragrance',
        targetId: id,
        payload: { name: after.name, changed, volumes: volumeChanges },
      });
      return { ok: true, value: after } as const;
    });
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
    if (i.similarIds.length) {
      await tx
        .insert(fragranceSimilar)
        .values(
          i.similarIds.map((similarId, position) => ({ fragranceId: id, similarId, position })),
        );
    }
  }

  private async insertVolume(tx: DbOrTx, fragranceId: number, v: VolumeInput) {
    await tx.insert(volumes).values({
      fragranceId,
      ml: v.ml,
      price: v.price,
      salePrice: v.salePrice,
      saleEndsAt: v.saleEndsOn ? saleEndInstant(v.saleEndsOn) : null,
      onHand: v.onHand,
    });
  }

  /** The owner typed a new count for an existing volume (it differs from the one the form loaded). */
  private onHandEdited(v: VolumeInput) {
    return v.loadedOnHand != null && v.loadedOnHand !== v.onHand;
  }

  private volumeDiff(old: FragranceAdmin['volumes'][number], v: VolumeInput, writeOnHand: boolean) {
    const out: Record<string, [unknown, unknown]> = {};
    if (old.price !== v.price) out.price = [old.price, v.price];
    if (old.salePrice !== v.salePrice) out.salePrice = [old.salePrice, v.salePrice];
    if (old.saleEndsOn !== v.saleEndsOn) out.saleEndsOn = [old.saleEndsOn, v.saleEndsOn];
    if (writeOnHand && old.onHand !== v.onHand) out.onHand = [old.onHand, v.onHand];
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
    if (i.similarIds.length) {
      if (selfId !== null && i.similarIds.includes(selfId)) bad.push('similarIds');
      else {
        const found = await tx
          .select({ id: fragrances.id })
          .from(fragrances)
          .where(inArray(fragrances.id, i.similarIds));
        if (found.length !== i.similarIds.length) bad.push('similarIds');
      }
    }
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
    const table = kind === 'families' ? families : notes;
    const values = {
      nameRu: raw.nameRu,
      nameUz: normalizeUzbek(raw.nameUz),
      aliases: [...new Set(raw.aliases.map(normalizeUzbek))],
    };
    const target = kind === 'families' ? 'family' : 'note';
    try {
      return await this.db.transaction(async (tx) => {
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
                  .selectDistinct({ id: fragranceNotes.fragranceId })
                  .from(fragranceNotes)
                  .where(eq(fragranceNotes.noteId, id));
          await reindexFragrances(
            tx,
            used.map((u) => u.id),
          );
        }
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: `catalog.${target}_${id === null ? 'created' : 'updated'}`,
          targetType: target,
          targetId: rowId,
          payload: values,
        });
        const item = (await this.listDictionary(kind, tx)).find((d) => d.id === rowId)!;
        return { ok: true, value: item } as const;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail('conflict', ['nameRu']);
      throw e;
    }
  }

  // ---- on hand and photos ----

  async onHandList(q?: string): Promise<OnHandItem[]> {
    const where = q ? sql`${fragrances.name} ilike ${'%' + escapeLike(q) + '%'}` : undefined;
    const rows = await this.db
      .select({
        volumeId: volumes.id,
        fragranceId: fragrances.id,
        name: fragrances.name,
        ml: volumes.ml,
        onHand: volumes.onHand,
      })
      .from(volumes)
      .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
      .where(where)
      .orderBy(asc(sql`lower(${fragrances.name})`), asc(volumes.ml));
    const reserved = await reservedByVolume(
      this.db,
      rows.map((r) => r.volumeId),
    );
    return rows.map((r) => this.onHandItem(r, reserved.get(r.volumeId) ?? 0));
  }

  async setOnHand(actor: StaffRow, volumeId: number, onHand: number): Promise<Outcome<OnHandItem>> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(volumes).where(eq(volumes.id, volumeId)).for('update');
      if (!old) return fail('not_found');
      await tx
        .update(volumes)
        .set({ onHand, ...(old.onHand !== onHand ? { isPlaceholder: false } : {}) })
        .where(eq(volumes.id, volumeId));
      const [f] = await tx
        .select({ id: fragrances.id, name: fragrances.name })
        .from(fragrances)
        .where(eq(fragrances.id, old.fragranceId));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'catalog.on_hand_changed',
        targetType: 'volume',
        targetId: volumeId,
        payload: { fragrance: f!.name, ml: old.ml, onHand: [old.onHand, onHand] },
      });
      const reserved = (await reservedByVolume(tx, [volumeId])).get(volumeId) ?? 0;
      return {
        ok: true,
        value: this.onHandItem(
          { volumeId, fragranceId: f!.id, name: f!.name, ml: old.ml, onHand },
          reserved,
        ),
      } as const;
    });
  }

  private onHandItem(
    r: { volumeId: number; fragranceId: number; name: string; ml: number; onHand: number },
    reserved: number,
  ): OnHandItem {
    return {
      ...r,
      reserved,
      available: available(r.onHand, reserved),
      belowReserve: r.onHand < reserved,
    };
  }

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

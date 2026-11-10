import { createHash } from 'node:crypto';
import {
  IMPORT_ISSUE_CAP,
  utcToTashkent,
  type FragranceInput,
  type ImportCounts,
  type ImportIssue,
  type ImportReport,
} from '@lummi/contracts';
import {
  asc,
  eq,
  families,
  fragranceNotes,
  fragranceSimilar,
  fragrances,
  notes,
  sql,
  volumes,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CatalogAdminService, normalise } from '../admin/catalog-admin.service';
import { reservedByVolume } from '../catalog/catalog.service';
import type { Edges } from '../edges';
import { reindexFragrances } from '../search/search-index';
import { DB, EDGES } from '../tokens';
import { planImport, type FragranceOp, type Plan } from './plan';
import { fingerprint, readSnapshot, snapshotToData, type Snapshot } from './snapshot';
import { readWorkbook, writeWorkbook, type RawWorkbook } from './workbook';

/** Serialises imports; the row locks below keep other writers out while one runs. */
const IMPORT_LOCK = 1702;

export interface ImportLimits {
  maxBytes: number;
  maxRows: number;
}
export type ApplyResult =
  | { ok: true; counts: ImportCounts }
  | { ok: false; reason: 'invalid'; report: ImportReport }
  | { ok: false; reason: 'stale' };

class Abort extends Error {
  constructor(readonly result: Exclude<ApplyResult, { ok: true }>) {
    super('catalog import aborted');
  }
}

const fileIssue = (code: string, params?: ImportIssue['params']): ImportIssue => ({
  sheet: 'file',
  row: null,
  column: null,
  code,
  ...(params ? { params } : {}),
});
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const tokenOf = (file: string, snap: Snapshot) =>
  createHash('sha256').update(`${file}|${fingerprint(snap)}`).digest('hex');
const zipMagic = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3;

const EMPTY_COUNTS: ImportCounts = {
  fragrances: { new: 0, changed: 0, unchanged: 0, notInFile: 0 },
  volumes: { new: 0, changed: 0, unchanged: 0 },
  families: { new: 0, changed: 0 },
  notes: { new: 0, changed: 0 },
};

/**
 * Catalog import and export through `LUMMI_Katalog.xlsx` (#26). A dry run reads and plans against a
 * snapshot and writes nothing; «Применить» plans again under row locks, refuses if the catalog moved
 * since the dry run (a token over the file and the catalog), and writes through the admin form's own
 * create/update, in one transaction. Nothing is ever deleted.
 */
@Injectable()
export class CatalogImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Pick<Edges, 'clock'>,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CatalogAdminService) private readonly admin: CatalogAdminService,
  ) {}

  /** The current catalog in the template (what «Скачать каталог» sends). */
  async exportWorkbook(): Promise<Buffer> {
    return writeWorkbook(snapshotToData(await readSnapshot(this.db)));
  }

  /** The template: the dictionaries and no fragrances. */
  async templateWorkbook(): Promise<Buffer> {
    const data = snapshotToData(await readSnapshot(this.db));
    return writeWorkbook({ ...data, fragrances: [] });
  }

  private async parse(
    bytes: Buffer,
    limits: ImportLimits,
  ): Promise<{ raw: RawWorkbook } | { issues: ImportIssue[] }> {
    if (bytes.length > limits.maxBytes) {
      return { issues: [fileIssue('too_big', { max: limits.maxBytes })] };
    }
    if (!zipMagic(bytes)) return { issues: [fileIssue('not_xlsx')] };
    try {
      return { raw: await readWorkbook(bytes, { maxRows: limits.maxRows }) };
    } catch {
      return { issues: [fileIssue('not_xlsx')] };
    }
  }

  private today(): string {
    const t = utcToTashkent(this.edges.clock.now());
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  }

  /** Reads and plans; writes nothing. */
  async dryRun(bytes: Buffer, limits: ImportLimits): Promise<ImportReport> {
    const parsed = await this.parse(bytes, limits);
    if ('issues' in parsed) return this.report(EMPTY_COUNTS, parsed.issues, [], [], null);
    // one consistent view of the catalog for the plan, its reserve numbers and the token
    return this.db.transaction(
      async (tx) => {
        const snap = await readSnapshot(tx);
        const plan = planImport(parsed.raw, snap, { today: this.today() });
        const stock = await this.stockRows(tx, plan, snap);
        return this.report(
          plan.counts,
          plan.errors,
          [...plan.warnings, ...stock.flatMap(this.belowReserve)],
          stock,
          plan.errors.length ? null : tokenOf(sha(bytes), snap),
        );
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /** Writes the file in one transaction, or nothing. `token` comes from the dry run of this very file. */
  async apply(
    actor: StaffRow,
    bytes: Buffer,
    token: string,
    limits: ImportLimits,
  ): Promise<ApplyResult> {
    const parsed = await this.parse(bytes, limits);
    if ('issues' in parsed) {
      return { ok: false, reason: 'invalid', report: this.report(EMPTY_COUNTS, parsed.issues, [], [], null) };
    }
    return this.applyRaw(actor, parsed.raw, sha(bytes), token);
  }

  /**
   * The shared write path; the seed calls it with its own rows, no actor (no audit) and no token.
   * `seed` keeps what staff changed on a catalog that is already loaded.
   */
  async applyRaw(
    actor: StaffRow | null,
    raw: RawWorkbook,
    fileHash: string,
    token: string | null,
    opts: { seed?: boolean } = {},
  ): Promise<ApplyResult> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${IMPORT_LOCK})`);
        // like the admin form and checkout: fragrance rows, then volume rows, ascending id
        await tx.select({ id: fragrances.id }).from(fragrances).orderBy(asc(fragrances.id)).for('update');
        await tx.select({ id: volumes.id }).from(volumes).orderBy(asc(volumes.id)).for('update');
        const snap = await readSnapshot(tx);
        if (token !== null && token !== tokenOf(fileHash, snap)) {
          throw new Abort({ ok: false, reason: 'stale' });
        }
        const plan = planImport(raw, snap, { today: this.today(), seed: opts.seed });
        if (plan.errors.length) {
          throw new Abort({
            ok: false,
            reason: 'invalid',
            report: this.report(plan.counts, plan.errors, plan.warnings, [], null),
          });
        }
        await this.write(tx, actor, plan, fileHash, opts);
        return { ok: true, counts: plan.counts } as const;
      });
    } catch (e) {
      if (e instanceof Abort) return e.result;
      const code = (e as { code?: string; cause?: { code?: string } }) ?? {};
      if (code.code === '23505' || code.cause?.code === '23505') {
        return {
          ok: false,
          reason: 'invalid',
          report: this.report(EMPTY_COUNTS, [fileIssue('write_conflict')], [], [], null),
        };
      }
      throw e;
    }
  }

  // ---- internals ----

  private report(
    counts: ImportCounts,
    errors: ImportIssue[],
    warnings: ImportIssue[],
    stock: ImportReport['stock'],
    token: string | null,
  ): ImportReport {
    const order = { file: 0, fragrances: 1, volumes: 2, dictionary: 3 } as const;
    const sorted = [...errors].sort(
      (a, b) => order[a.sheet] - order[b.sheet] || (a.row ?? 0) - (b.row ?? 0),
    );
    return {
      counts,
      errors: sorted.slice(0, IMPORT_ISSUE_CAP),
      errorTotal: errors.length,
      warnings: warnings.slice(0, IMPORT_ISSUE_CAP),
      warningTotal: warnings.length,
      stock,
      token,
    };
  }

  private belowReserve = (s: ImportReport['stock'][number]): ImportIssue[] =>
    s.negative
      ? [
          {
            sheet: 'volumes',
            row: s.row,
            column: null,
            code: 'below_reserve',
            params: { name: s.name, ml: s.ml, onHand: s.newOnHand, reserved: s.reserved },
          },
        ]
      : [];

  /** on hand → reserve → resulting available for every volume whose count the file sets. */
  private async stockRows(db: DbOrTx, plan: Plan, snap: Snapshot): Promise<ImportReport['stock']> {
    const ids = plan.stock.flatMap((s) => {
      const id = snap.byCode.get(s.code)?.volumes.get(s.ml)?.id;
      return id ? [id] : [];
    });
    const reserved = await reservedByVolume(db, ids);
    return plan.stock.map((s) => {
      const id = snap.byCode.get(s.code)?.volumes.get(s.ml)?.id;
      const held = id ? (reserved.get(id) ?? 0) : 0;
      const available = s.newOnHand - held;
      return { ...s, reserved: held, available, negative: available < 0 };
    });
  }

  private toInput(
    op: FragranceOp,
    ids: {
      family: Map<string, number>;
      note: Map<string, number>;
      fragrance: Map<string, number>;
    },
    withSimilar: boolean,
  ): FragranceInput {
    const d = op.draft;
    const noteIds = (names: string[]) => names.map((n) => ids.note.get(n)!);
    return {
      name: d.name,
      originalBrand: d.originalBrand,
      type: d.type,
      familyId: d.family ? (ids.family.get(d.family) ?? null) : null,
      season: d.season,
      timeOfDay: d.timeOfDay,
      sillage: d.sillage,
      longevityRu: d.longevityRu,
      longevityUz: d.longevityUz,
      descriptionRu: d.descriptionRu,
      descriptionUz: d.descriptionUz,
      whenToWearRu: d.whenToWearRu,
      whenToWearUz: d.whenToWearUz,
      keyNotesRu: d.keyNotesRu,
      keyNotesUz: d.keyNotesUz,
      internalRemark: d.internalRemark || null,
      aliases: d.aliases,
      uzumUrl: d.uzumUrl || null,
      isHit: d.isHit,
      isNew: d.isNew,
      hidden: d.hidden,
      notes: { top: noteIds(d.topNotes), heart: noteIds(d.heartNotes), base: noteIds(d.baseNotes) },
      similarIds: withSimilar ? d.similar.map((c) => ids.fragrance.get(c)!) : [],
      volumes: op.volumes.map((v) => ({
        ml: v.ml,
        price: v.price,
        salePrice: v.salePrice,
        saleEndsOn: v.saleEndsOn,
        onHand: v.onHand,
        loadedOnHand: v.loadedOnHand,
      })),
    };
  }

  private async write(
    tx: DbOrTx,
    actor: StaffRow | null,
    plan: Plan,
    fileHash: string,
    opts: { seed?: boolean },
  ) {
    const who = actor ? ({ type: 'staff', id: actor.id } as const) : null;
    const reindex = new Set<number>();

    // dictionaries first: fragrances refer to them by name
    for (const kind of ['families', 'notes'] as const) {
      const table = kind === 'families' ? families : notes;
      const target = kind === 'families' ? 'family' : 'note';
      for (const o of plan[kind]) {
        let id = o.existingId;
        if (id === null) {
          const [row] = await tx
            .insert(table)
            .values({ nameRu: o.nameRu, nameUz: o.nameUz })
            .returning({ id: table.id });
          id = row!.id;
        } else {
          await tx.update(table).set({ nameUz: o.nameUz }).where(eq(table.id, id));
          const used =
            kind === 'families'
              ? await tx.select({ id: fragrances.id }).from(fragrances).where(eq(fragrances.familyId, id))
              : await tx
                  .select({ id: fragranceNotes.fragranceId })
                  .from(fragranceNotes)
                  .where(eq(fragranceNotes.noteId, id))
                  .groupBy(fragranceNotes.fragranceId);
          for (const u of used) reindex.add(u.id);
        }
        if (who) {
          await this.audit.record(tx, {
            actor: who,
            action: `catalog.${target}_${o.existingId === null ? 'created' : 'updated'}`,
            targetType: target,
            targetId: id,
            payload: { nameRu: o.nameRu, nameUz: o.nameUz, source: 'import' },
          });
        }
      }
    }
    const ids = {
      family: new Map((await tx.select().from(families)).map((r) => [r.nameRu, r.id])),
      note: new Map((await tx.select().from(notes)).map((r) => [r.nameRu, r.id])),
      fragrance: new Map<string, number>(),
    };
    const fail = (op: FragranceOp, fields?: string[]) =>
      new Abort({
        ok: false,
        reason: 'invalid',
        report: this.report(
          plan.counts,
          [
            {
              sheet: 'fragrances',
              row: op.row,
              column: null,
              code: 'rejected',
              params: { fields: (fields ?? []).join(', ') },
            },
          ],
          [],
          [],
          null,
        ),
      });

    // new fragrances first (similar links may point at them), then the changed ones
    const fresh = plan.fragrances.filter((o) => o.existingId === null);
    for (const op of fresh) {
      const res = await this.admin.createWithin(
        tx,
        actor,
        normalise(this.toInput(op, ids, false)),
        { code: op.code, source: 'import', placeholder: opts.seed },
      );
      if (!res.ok) throw fail(op, res.fields);
    }
    for (const r of await tx.select({ id: fragrances.id, code: fragrances.code }).from(fragrances)) {
      ids.fragrance.set(r.code, r.id);
    }
    for (const op of plan.fragrances.filter((o) => o.existingId !== null)) {
      const res = await this.admin.updateWithin(
        tx,
        actor,
        op.existingId!,
        normalise(this.toInput(op, ids, true)),
        { source: 'import' },
      );
      if (!res.ok) throw fail(op, res.fields);
    }
    for (const op of fresh.filter((o) => o.draft.similar.length)) {
      const id = ids.fragrance.get(op.code)!;
      await tx
        .insert(fragranceSimilar)
        .values(
          op.draft.similar.map((c, position) => ({
            fragranceId: id,
            similarId: ids.fragrance.get(c)!,
            position,
          })),
        );
    }
    if (reindex.size) await reindexFragrances(tx, [...reindex]);
    if (who) {
      await this.audit.record(tx, {
        actor: who,
        action: 'catalog.import_applied',
        targetType: 'catalog',
        payload: { counts: plan.counts, file: fileHash.slice(0, 16) },
      });
    }
  }
}


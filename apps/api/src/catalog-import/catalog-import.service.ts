import { createHash } from 'node:crypto';
import {
  IMPORT_CHANGE_CAP,
  IMPORT_ISSUE_CAP,
  utcToTashkent,
  type FragranceInput,
  type ImportChange,
  type ImportCounts,
  type ImportIssue,
  type ImportReport,
} from '@lummi/contracts';
import {
  asc,
  eq,
  families,
  fragrances,
  inArray,
  notes,
  sql,
  volumes,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CatalogAdminService, isUniqueViolation, normalise } from '../admin/catalog-admin.service';
import { readLiquidStock } from '../catalog/catalog.service';
import { mlFromUl } from '../warehouse/oil';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { planImport, sortChanges, type FragranceOp, type Plan } from './plan';
import { fingerprint, readSnapshot, snapshotToData, type Snapshot } from './snapshot';
import {
  UNPACK_RATIO,
  readWorkbook,
  writeWorkbook,
  zipUnpackedBytes,
  type RawWorkbook,
} from './workbook';

/** Serialises imports; the row locks below keep other writers out while one runs. */
const IMPORT_LOCK = 1702;

export interface ImportLimits {
  maxBytes: number;
  maxRows: number;
}
export type ApplyResult =
  | { ok: true; counts: ImportCounts; warnings: ImportIssue[] }
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
    const unpacked = zipUnpackedBytes(bytes);
    if (unpacked === null) return { issues: [fileIssue('not_xlsx')] };
    if (unpacked > limits.maxBytes * UNPACK_RATIO) {
      return { issues: [fileIssue('too_unpacked', { max: limits.maxBytes * UNPACK_RATIO })] };
    }
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
          plan.changes,
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
        // dictionary rows first (the import may rename them), then like the admin form and
        // checkout: fragrance rows, then volume rows, ascending id
        await tx.select({ id: families.id }).from(families).orderBy(asc(families.id)).for('update');
        await tx.select({ id: notes.id }).from(notes).orderBy(asc(notes.id)).for('update');
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
        const warnings = await this.write(tx, actor, plan, fileHash, opts);
        return { ok: true, counts: plan.counts, warnings } as const;
      });
    } catch (e) {
      if (e instanceof Abort) return e.result;
      if (isUniqueViolation(e)) {
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
    changes: ImportChange[] = [],
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
      changes: sortChanges(changes).slice(0, IMPORT_CHANGE_CAP),
      changeTotal: changes.length,
      token,
    };
  }

  private belowReserve = (s: ImportReport['stock'][number]): ImportIssue[] =>
    s.negative
      ? [
          {
            sheet: 'fragrances',
            row: s.row,
            column: null,
            code: 'below_reserve',
            params: { name: s.name, onHand: s.newConcentrateMl, reserved: s.reservedMl },
          },
        ]
      : [];

  /** concentrate → reserve → resulting free ml for every fragrance whose count the file sets (ADR 0043). */
  private async stockRows(db: DbOrTx, plan: Plan, snap: Snapshot): Promise<ImportReport['stock']> {
    const ids = plan.stock.flatMap((s) => {
      const id = snap.byCode.get(s.code)?.id;
      return id ? [id] : [];
    });
    const stock = await readLiquidStock(db, ids);
    return plan.stock.map((s) => {
      const id = snap.byCode.get(s.code)?.id;
      const held = id ? mlFromUl(stock.of(id).reservedUl) : 0;
      const availableMl = Math.round((s.newConcentrateMl - held) * 1000) / 1000;
      return { ...s, reservedMl: held, availableMl, negative: availableMl < 0 };
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
      oilPrice: d.oilPrice,
      tier: d.tier,
      oilSupplier: d.oilSupplier || null,
      oilInvoice: d.oilInvoice || null,
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
      })),
      concentrateMl: d.concentrateMl,
      loadedConcentrateMl: op.loadedConcentrateMl,
    };
  }

  private async write(
    tx: DbOrTx,
    actor: StaffRow | null,
    plan: Plan,
    fileHash: string,
    opts: { seed?: boolean },
  ): Promise<ImportIssue[]> {
    const who = actor ? ({ type: 'staff', id: actor.id } as const) : null;

    const reject = (sheet: 'fragrances' | 'dictionary', row: number | null, fields: string[]) =>
      new Abort({
        ok: false,
        reason: 'invalid',
        report: this.report(
          plan.counts,
          [{ sheet, row, column: null, code: 'rejected', params: { fields: fields.join(', ') } }],
          [],
          [],
          null,
        ),
      });
    const fail = (op: FragranceOp, fields: string[] = []) => reject('fragrances', op.row, fields);

    // dictionaries first: fragrances refer to them by name. The admin's own dictionary save (same
    // rules, reindex of the fragrances that use the entry, audit); an existing entry keeps its aliases.
    for (const kind of ['families', 'notes'] as const) {
      const table = kind === 'families' ? families : notes;
      for (const o of plan[kind]) {
        const [have] =
          o.existingId === null
            ? []
            : await tx.select({ aliases: table.aliases }).from(table).where(eq(table.id, o.existingId));
        const res = await this.admin.saveDictionaryWithin(tx, actor, kind, o.existingId, {
          nameRu: o.nameRu,
          nameUz: o.nameUz,
          aliases: have?.aliases ?? [],
        });
        if (!res.ok) throw reject('dictionary', null, [o.nameRu]);
      }
    }
    const ids = {
      family: new Map((await tx.select().from(families)).map((r) => [r.nameRu, r.id])),
      note: new Map((await tx.select().from(notes)).map((r) => [r.nameRu, r.id])),
      fragrance: new Map<string, number>(),
    };
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
      const linked = await this.admin.linkSimilarWithin(
        tx,
        ids.fragrance.get(op.code)!,
        op.draft.similar.map((c) => ids.fragrance.get(c)!),
      );
      if (!linked) throw fail(op, ['similarIds']);
    }
    // The dry run's reserve numbers may be old: count again under the volume locks, and say so if
    // any count the file set now sits below what open orders hold (never written unseen, ADR 0010).
    const below = await this.belowReserveNow(tx, plan);
    if (who) {
      await this.audit.record(tx, {
        actor: who,
        action: 'catalog.import_applied',
        targetType: 'catalog',
        payload: {
          counts: plan.counts,
          file: fileHash.slice(0, 16),
          ...(below.length ? { belowReserve: below.map((w) => w.params) } : {}),
        },
      });
    }
    return below;
  }

  /** Fragrances the file set a concentrate for that now hold less than the open orders reserve. */
  private async belowReserveNow(tx: DbOrTx, plan: Plan): Promise<ImportIssue[]> {
    if (!plan.stock.length) return [];
    const rows = await tx
      .select({ id: fragrances.id, code: fragrances.code })
      .from(fragrances)
      .where(inArray(fragrances.code, [...new Set(plan.stock.map((s) => s.code))]));
    const touched = new Map(plan.stock.map((s) => [s.code, s]));
    const stock = await readLiquidStock(
      tx,
      rows.map((r) => r.id),
    );
    return rows.flatMap((r) => {
      const l = stock.of(r.id);
      if (l.concentrateUl >= l.reservedUl) return [];
      const s = touched.get(r.code)!;
      return [
        {
          sheet: 'fragrances' as const,
          row: s.row,
          column: null,
          code: 'below_reserve',
          params: {
            name: s.name,
            onHand: mlFromUl(l.concentrateUl),
            reserved: mlFromUl(l.reservedUl),
          },
        },
      ];
    });
  }
}


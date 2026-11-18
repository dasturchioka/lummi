import { createHash } from 'node:crypto';
import {
  UZUM_IMPORT_ISSUE_CAP,
  UZUM_IMPORT_SALE_CAP,
  formatLocalDate,
  tashkentDay,
  type UzumImportApplied,
  type UzumImportIssue,
  type UzumImportReport,
  type UzumShortLine,
} from '@lummi/contracts';
import {
  and,
  asc,
  fragrances,
  inArray,
  isNull,
  uzumSales,
  volumes,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { ImportLimits } from '../catalog-import/catalog-import.service';
import { UNPACK_RATIO, zipUnpackedBytes } from '../catalog-import/workbook';
import { readCostSettings } from '../cost/cost-settings';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import {
  planUzumImport,
  readUzumWorkbook,
  saleSummary,
  writeUzumTemplate,
  type PlannedUzumSale,
  type UzumCatalogFragrance,
  type UzumPlan,
  type UzumRawRow,
} from './uzum-import';
import { saleItems, UzumSalesService, type NewUzumSale } from './uzum-sales.service';

export type UzumApplyResult =
  | { ok: true; applied: UzumImportApplied }
  | { ok: false; reason: 'invalid'; report: UzumImportReport }
  | { ok: false; reason: 'stale' | 'try_again' };

class Abort extends Error {
  constructor(readonly report: UzumImportReport) {
    super('uzum import aborted');
  }
}

const fileIssue = (code: UzumImportIssue['code'], params?: UzumImportIssue['params']) => ({
  row: null,
  column: null,
  code,
  ...(params ? { params } : {}),
});
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const zipMagic = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3;

/**
 * Uzum sales from an Excel file (#80), the catalog import's way (#26): a dry run reads and plans
 * and writes nothing; «Записать» sends the same file back with the dry run's token (the file's
 * hash), plans again inside the write's transaction and records every sale the file holds, all or
 * none, through the form's own writer, which checks the stock under the locks.
 */
@Injectable()
export class UzumImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Pick<Edges, 'clock'>,
    @Inject(UzumSalesService) private readonly sales: UzumSalesService,
  ) {}

  async template(): Promise<Buffer> {
    return writeUzumTemplate(await readCatalog(this.db));
  }

  private today() {
    return formatLocalDate(tashkentDay(this.edges.clock.now()));
  }

  private async parse(
    bytes: Buffer,
    limits: ImportLimits,
  ): Promise<{ rows: UzumRawRow[] } | { issues: UzumImportIssue[] }> {
    if (bytes.length > limits.maxBytes)
      return { issues: [fileIssue('too_big', { max: limits.maxBytes })] };
    if (!zipMagic(bytes)) return { issues: [fileIssue('not_xlsx')] };
    const unpacked = zipUnpackedBytes(bytes);
    if (unpacked === null) return { issues: [fileIssue('not_xlsx')] };
    if (unpacked > limits.maxBytes * UNPACK_RATIO)
      return { issues: [fileIssue('too_unpacked', { max: limits.maxBytes * UNPACK_RATIO })] };
    try {
      const read = await readUzumWorkbook(bytes, limits.maxRows);
      return read.issues.length ? { issues: read.issues } : { rows: read.rows };
    } catch {
      return { issues: [fileIssue('not_xlsx')] };
    }
  }

  /** Reads, plans and checks the stock (as of now, without locks); writes nothing. */
  async dryRun(bytes: Buffer, limits: ImportLimits): Promise<UzumImportReport> {
    const parsed = await this.parse(bytes, limits);
    if ('issues' in parsed) return report(emptyPlan(parsed.issues), 0, null);
    return this.db.transaction(
      async (tx) => {
        const { plan, commission } = await this.plan(tx, parsed.rows);
        if (plan.errors.length === 0) plan.errors.push(...(await stockIssues(tx, plan.sales)));
        const token = plan.errors.length === 0 && plan.sales.length > 0 ? sha(bytes) : null;
        return report(plan, commission, token);
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /** Records the file's sales in one transaction, or nothing. `token` is the dry run's of this file. */
  async apply(
    actor: StaffRow,
    bytes: Buffer,
    token: string,
    limits: ImportLimits,
  ): Promise<UzumApplyResult> {
    const parsed = await this.parse(bytes, limits);
    if ('issues' in parsed)
      return { ok: false, reason: 'invalid', report: report(emptyPlan(parsed.issues), 0, null) };
    if (token !== sha(bytes)) return { ok: false, reason: 'stale' };
    let planned: { plan: UzumPlan; commission: number } | null = null;
    try {
      const res = await this.sales.recordMany(actor, async (tx) => {
        planned = await this.plan(tx, parsed.rows);
        if (planned.plan.errors.length || planned.plan.sales.length === 0)
          throw new Abort(report(planned.plan, planned.commission, null));
        return planned.plan.sales.map(toNewSale);
      });
      if (res.ok) {
        const { plan, commission } = planned!;
        const sums = report(plan, commission, null);
        return {
          ok: true,
          applied: {
            recorded: res.value.length,
            units: sums.units,
            revenue: sums.revenue,
            skipped: plan.skipped,
          },
        };
      }
      const p = planned as { plan: UzumPlan; commission: number } | null;
      if (res.reason === 'try_again') return { ok: false, reason: 'try_again' };
      if (res.reason === 'stock_short' && p) {
        p.plan.errors.push(...res.short.map(shortIssue));
        return { ok: false, reason: 'invalid', report: report(p.plan, p.commission, null) };
      }
      // a sale recorded meanwhile with one of the file's numbers, or a volume gone: plan again
      return { ok: false, reason: 'stale' };
    } catch (e) {
      if (e instanceof Abort) return { ok: false, reason: 'invalid', report: e.report };
      throw e;
    }
  }

  private async plan(tx: DbOrTx, rows: UzumRawRow[]) {
    const catalog = await readCatalog(tx);
    const orders = [...new Set(rows.map((r) => r.cells.uzumOrder).filter(Boolean))];
    const standing = orders.length
      ? await tx
          .select({ uzumOrder: uzumSales.uzumOrder })
          .from(uzumSales)
          .where(and(inArray(uzumSales.uzumOrder, orders), isNull(uzumSales.voidedAt)))
      : [];
    const plan = planUzumImport(rows, catalog, {
      today: this.today(),
      standing: new Set(standing.map((s) => s.uzumOrder)),
    });
    const { order } = await readCostSettings(tx);
    return { plan, commission: order.uzumCommissionPercent };
  }
}

const toNewSale = (s: PlannedUzumSale): NewUzumSale => ({
  soldOn: s.soldOn,
  uzumOrder: s.uzumOrder,
  ...(s.commissionPercent === null ? {} : { commissionPercent: s.commissionPercent }),
  lines: s.lines,
  via: 'import',
  rows: s.rows,
});

const emptyPlan = (errors: UzumImportIssue[]): UzumPlan => ({
  sales: [],
  skipped: 0,
  errors,
  warnings: [],
});

function report(plan: UzumPlan, commission: number, token: string | null): UzumImportReport {
  const sales = plan.sales.map((s) => saleSummary(s, commission));
  const errors = [...plan.errors].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return {
    sales: sales.slice(0, UZUM_IMPORT_SALE_CAP),
    saleTotal: sales.length,
    units: sales.reduce((sum, s) => sum + s.units, 0),
    revenue: sales.reduce((sum, s) => sum + s.revenue, 0),
    skipped: plan.skipped,
    errors: errors.slice(0, UZUM_IMPORT_ISSUE_CAP),
    errorTotal: errors.length,
    warnings: plan.warnings.slice(0, UZUM_IMPORT_ISSUE_CAP),
    warningTotal: plan.warnings.length,
    token,
  };
}

const shortIssue = (s: UzumShortLine): UzumImportIssue => ({
  row: null,
  column: null,
  code: 'stock_short',
  params: {
    name: s.name ?? 'Discovery set',
    ml: s.ml ?? '',
    wanted: s.wanted,
    available: s.available,
  },
});

/** The file's sales against what is available now (on hand less the reserve), without locks. */
async function stockIssues(
  tx: DbOrTx,
  sales: readonly PlannedUzumSale[],
): Promise<UzumImportIssue[]> {
  const wanted = new Map<number | 'set', number>();
  for (const l of sales.flatMap((s) => s.lines)) {
    const key = l.kind === 'volume' ? l.volumeId : 'set';
    wanted.set(key, (wanted.get(key) ?? 0) + l.qty);
  }
  if (wanted.size === 0) return [];
  const items = await saleItems(tx);
  const out: UzumShortLine[] = [];
  for (const [key, want] of wanted) {
    const item = items.find((i) =>
      key === 'set' ? i.kind === 'discovery_set' : i.kind === 'volume' && i.volumeId === key,
    );
    if (!item || want <= item.available) continue;
    out.push({
      kind: item.kind,
      volumeId: item.kind === 'volume' ? item.volumeId : null,
      name: item.kind === 'volume' ? item.name : null,
      ml: item.kind === 'volume' ? item.ml : null,
      wanted: want,
      available: item.available,
    });
  }
  return out.map(shortIssue);
}

/** Every fragrance with its volumes, for the template and the plan. */
async function readCatalog(tx: DbOrTx): Promise<UzumCatalogFragrance[]> {
  const fs = await tx
    .select({
      id: fragrances.id,
      name: fragrances.name,
      code: fragrances.code,
      hidden: fragrances.hidden,
    })
    .from(fragrances)
    .orderBy(asc(fragrances.id));
  const vs = await tx
    .select({ id: volumes.id, fragranceId: volumes.fragranceId, ml: volumes.ml })
    .from(volumes)
    .orderBy(asc(volumes.ml));
  return fs.map((f) => ({
    ...f,
    volumes: vs.filter((v) => v.fragranceId === f.id).map(({ id, ml }) => ({ id, ml })),
  }));
}

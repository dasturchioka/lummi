import type { StockLevel, StockList, StockQuery, StockRow } from '@lummi/contracts';
import { asc, eq, fragrances, sql, volumes, type Db, type DbOrTx, type StaffRow } from '@lummi/db';
import { normalizeUzbek, stripApostrophes } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { available, belowReserve, reservedByVolume } from '../catalog/catalog.service';
import { loadDiscovery } from '../sets/sets';
import { readSettings } from '../settings/settings.service';
import { isOwner } from '../staff/staff.guard';
import { DB } from '../tokens';
import { containsIgnoringApostrophes } from '../util/apostrophe-match';
import { fragranceOils, readOilContext } from '../warehouse/fragrance-oil';

/**
 * The stock page's read side (#27): on hand, reserve and available per volume and for the
 * Discovery set. Nothing here decides a number: the Reserve is `reservedByVolume` and the
 * Discovery set's own is `loadDiscovery`, the same code checkout and the shop use. The writes are
 * `CatalogAdminService.setOnHand` and `SetsAdminService.setOnHand`.
 */
/** What the row is called on the page, in both languages (the panel's «Наборы» / «Toʻplamlar»), so a search by any of them finds it. */
const DISCOVERY_LABELS = [
  'Discovery set',
  'Набор Discovery',
  'Наборы',
  'Toʻplam',
  'Discovery toʻplami',
];
const fold = (s: string) => stripApostrophes(normalizeUzbek(s)).toLowerCase();
const matchesDiscoveryLabel = (q: string) =>
  fold(q) !== '' && DISCOVERY_LABELS.some((label) => fold(label).includes(fold(q)));

/** The server decides what is "nothing left" and "running low" (the setting), the client only draws it. */
export const stockLevel = (availableNow: number, lowThreshold: number): StockLevel =>
  availableNow === 0 ? 'zero' : availableNow <= lowThreshold ? 'low' : 'ok';

/**
 * Every stock row as the stock page shows it: each fragrance's volumes (name order, a fragrance's
 * volumes together; `q` narrows by name), and the Discovery set's own row. The stock page pages
 * them; the admin Home (#48) counts those with nothing left or running low.
 */
export async function stockRows(
  db: DbOrTx,
  lowThreshold: number,
  q?: string,
): Promise<{ volumes: StockRow[]; discovery: StockRow }> {
  const volumeRows = await db
    .select({
      volumeId: volumes.id,
      fragranceId: fragrances.id,
      name: fragrances.name,
      hidden: fragrances.hidden,
      ml: volumes.ml,
      onHand: volumes.onHand,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(q ? containsIgnoringApostrophes(fragrances.name, q) : undefined)
    .orderBy(asc(sql`lower(${fragrances.name})`), asc(fragrances.id), asc(volumes.ml));
  const reserved = await reservedByVolume(
    db,
    volumeRows.map((r) => r.volumeId),
  );
  const rows: StockRow[] = volumeRows.map((r) => {
    const held = reserved.get(r.volumeId) ?? 0;
    return {
      kind: 'volume',
      key: `v${r.volumeId}`,
      volumeId: r.volumeId,
      fragranceId: r.fragranceId,
      name: r.name,
      hidden: r.hidden,
      ml: r.ml,
      onHand: r.onHand,
      reserved: held,
      available: available(r.onHand, held),
      belowReserve: belowReserve(r.onHand, held),
      level: stockLevel(available(r.onHand, held), lowThreshold),
    };
  });
  const set = await loadDiscovery(db);
  const discovery: StockRow = {
    kind: 'discovery',
    key: 'discovery',
    volumeId: null,
    fragranceId: null,
    name: null,
    hidden: false,
    ml: null,
    onHand: set.row.onHand,
    reserved: set.reserved,
    available: set.available,
    belowReserve: belowReserve(set.row.onHand, set.reserved),
    level: stockLevel(set.available, lowThreshold),
  };
  return { volumes: rows, discovery };
}

/**
 * The stock page's filters, one rule for the page and the Home's link to it. `oilLevelOf` gives a
 * fragrance's low-oil level (#76) for the `oilLow` filter; the Discovery set has no oil.
 */
export function matchesStockQuery(
  r: StockRow,
  query: Pick<StockQuery, 'filter' | 'visibility'>,
  oilLevelOf?: (fragranceId: number) => StockLevel | undefined,
): boolean {
  if (query.filter === 'oilLow') {
    const level = r.fragranceId === null ? undefined : oilLevelOf?.(r.fragranceId);
    if (level === undefined || level === 'ok') return false;
  }
  if (query.filter === 'zero' && r.level !== 'zero') return false;
  if (query.filter === 'low' && r.level === 'ok') return false;
  if (query.visibility === 'hidden' && !r.hidden) return false;
  if (query.visibility === 'visible' && r.hidden) return false;
  return true;
}

@Injectable()
export class StockAdminService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The page's rows and each fragrance's oil (#76); stock values for the owner only (ADR 0041). */
  async list(query: StockQuery, viewer: StaffRow): Promise<StockList> {
    const { 'stock.lowAvailableThreshold': lowThreshold } = await readSettings(this.db, [
      'stock.lowAvailableThreshold',
    ]);
    const q = query.q?.trim();
    const { volumes: rows, discovery } = await stockRows(this.db, lowThreshold, q);
    const ctx = await readOilContext(this.db, isOwner(viewer));
    const oil = await fragranceOils(this.db, [...new Set(rows.map((r) => r.fragranceId!))], ctx);
    const matching = (r: StockRow) => matchesStockQuery(r, query, (id) => oil.get(id)?.level);
    const shown = rows.filter(matching);

    // pages hold whole fragrances (the rows are in name order, a fragrance's volumes together)
    const fragranceIds = [...new Set(shown.map((r) => r.fragranceId))];
    const first = (query.page - 1) * query.pageSize;
    const onPage = new Set(fragranceIds.slice(first, first + query.pageSize));
    const pageRows = shown.filter((r) => onPage.has(r.fragranceId));

    // the Discovery set is the one row that is not a fragrance: first on page 1, when it matches
    if (query.page === 1 && (!q || matchesDiscoveryLabel(q)) && matching(discovery))
      pageRows.unshift(discovery);

    return {
      lowThreshold,
      lowOilLitres: ctx.lowOilLitres,
      oil: [...onPage].map((id) => oil.get(id!)!),
      rows: pageRows,
      total: fragranceIds.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

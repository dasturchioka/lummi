import type {
  StockFragranceRow,
  StockLevel,
  StockList,
  StockQuery,
  StockSetRow,
} from '@lummi/contracts';
import { asc, fragrances, inArray, sql, type Db, type DbOrTx, type StaffRow } from '@lummi/db';
import { normalizeUzbek, stripApostrophes } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { belowReserve } from '../catalog/catalog.service';
import { DISCOVERY_SETS, DISCOVERY_VIAL_MLS } from '@lummi/contracts/constants';
import { giftSampleStock } from '../orders/gift-sample';
import { loadDiscovery } from '../sets/sets';
import { readSettings } from '../settings/settings.service';
import { isOwner } from '../staff/staff.guard';
import { DB } from '../tokens';
import { containsIgnoringApostrophes } from '../util/apostrophe-match';
import { fragranceStocks, readStockContext, type StockContext } from '../warehouse/fragrance-stock';

/**
 * The stock page's read side (#27, ADR 0043): each fragrance's ready concentrate, reserve, free ml,
 * the bottles that fills and its oil; each Discovery set's own boxes. Nothing here decides a
 * number: the Reserve and the fills are `readLiquidStock`'s, the Discovery set's `loadDiscovery`'s,
 * the same code checkout and the shop use. The writes are the warehouse's and
 * `SetsAdminService.setOnHand`.
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
 * Every stock row as the stock page shows it: each fragrance (name order; `q` narrows by name)
 * with its stock (ADR 0043), and each Discovery set's own row (ADR 0042). The stock page pages
 * them; the admin Home (#48) counts those with nothing left or running low.
 */
export async function stockRows(
  db: DbOrTx,
  ctx: StockContext,
  lowThreshold: number,
  q?: string,
): Promise<{ fragrances: StockFragranceRow[]; sets: StockSetRow[] }> {
  const rows = await db
    .select({ id: fragrances.id, name: fragrances.name, hidden: fragrances.hidden })
    .from(fragrances)
    .where(q ? containsIgnoringApostrophes(fragrances.name, q) : undefined)
    .orderBy(asc(sql`lower(${fragrances.name})`), asc(fragrances.id));
  const stock = await fragranceStocks(
    db,
    rows.map((r) => r.id),
    ctx,
  );
  const sets: StockSetRow[] = [];
  for (const vialMl of DISCOVERY_VIAL_MLS) {
    const set = await loadDiscovery(db, vialMl);
    sets.push({
      vialMl,
      key: DISCOVERY_SETS[vialMl].key,
      onHand: set.row.onHand,
      reserved: set.reserved,
      available: set.available,
      belowReserve: belowReserve(set.row.onHand, set.reserved),
      level: stockLevel(set.available, lowThreshold),
    });
  }
  return {
    fragrances: rows.map((r) => ({ ...stock.get(r.id)!, name: r.name, hidden: r.hidden })),
    sets,
  };
}

/**
 * The stock page's filters, one rule for the page and the Home's link to it. «Нет в наличии» and
 * «Заканчивается» read a fragrance's concentrate level (`stock.lowConcentrateMl`) and a set's
 * boxes; «Мало масла» the oil (a set has none).
 */
export function matchesStockQuery(
  r: { level: StockLevel; hidden?: boolean; oilLevel?: StockLevel },
  query: Pick<StockQuery, 'filter' | 'visibility'>,
): boolean {
  if (query.filter === 'oilLow' && (r.oilLevel === undefined || r.oilLevel === 'ok')) return false;
  if (query.filter === 'zero' && r.level !== 'zero') return false;
  if (query.filter === 'low' && r.level === 'ok') return false;
  if (query.visibility === 'hidden' && !r.hidden) return false;
  if (query.visibility === 'visible' && r.hidden) return false;
  return true;
}

@Injectable()
export class StockAdminService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The page's fragrances and the Discovery sets; stock values for the owner only (ADR 0041). */
  async list(query: StockQuery, viewer: StaffRow): Promise<StockList> {
    const {
      'stock.lowAvailableThreshold': lowThreshold,
      'stock.shownDefault': shownDefault,
      'stock.shownMax': shownMax,
    } = await readSettings(this.db, [
      'stock.lowAvailableThreshold',
      'stock.shownDefault',
      'stock.shownMax',
    ]);
    const q = query.q?.trim();
    const ctx = await readStockContext(this.db, isOwner(viewer));
    const rows = await stockRows(this.db, ctx, lowThreshold, q);
    const matching = rows.fragrances.filter((r) => matchesStockQuery(r, query));
    const first = (query.page - 1) * query.pageSize;
    const page = matching.slice(first, first + query.pageSize);
    // the Discovery sets are the rows that are not a fragrance: on page 1, when they match
    const sets =
      query.page === 1 && (!q || matchesDiscoveryLabel(q))
        ? rows.sets.filter((r) => matchesStockQuery(r, query))
        : [];
    const own = page.length
      ? await this.db
          .select({ fragranceId: fragrances.id, shownCount: fragrances.shownCount })
          .from(fragrances)
          .where(
            inArray(
              fragrances.id,
              page.map((r) => r.fragranceId),
            ),
          )
      : [];
    return {
      shown: { default: shownDefault, max: shownMax, own },
      lowThreshold,
      lowConcentrateMl: ctx.lowConcentrateMl,
      lowOilMl: ctx.lowOilMl,
      fragrances: page,
      sets,
      total: matching.length,
      page: query.page,
      pageSize: query.pageSize,
      giftSample: await giftSampleStock(this.db),
    };
  }
}

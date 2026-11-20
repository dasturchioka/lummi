import { round3, type FragranceStock } from '@lummi/contracts';
import { VOLUMES_ML } from '@lummi/contracts/constants';
import {
  and,
  fragrances,
  inArray,
  isNull,
  oilReceipts,
  sellableVolume,
  volumes,
  type DbOrTx,
} from '@lummi/db';
import { available, belowReserve, bottlesOf, readLiquidStock } from '../catalog/catalog.service';
import { concentrateCost, fillUl, type CostSettings } from '../cost/unit-cost';
import { readCostSettings } from '../cost/cost-settings';
import { readSettings } from '../settings/settings.service';
import {
  concentrateLevel,
  gramsFromMg,
  mlFromUl,
  stockLevelOf,
  oilMlOf,
  oilValue,
  type OilReceiptPrice,
} from './oil';

/** What every stock summary needs, read once per request. */
export interface StockContext {
  costs: CostSettings;
  /** The settings `stock.lowConcentrateMl` and `stock.lowOilMl` (ADR 0043). */
  lowConcentrateMl: number;
  lowOilMl: number;
  /** The owner sees stock values; a manager does not (ADR 0041). */
  withValue: boolean;
}

export async function readStockContext(tx: DbOrTx, withValue: boolean): Promise<StockContext> {
  const costs = await readCostSettings(tx);
  const s = await readSettings(tx, ['stock.lowConcentrateMl', 'stock.lowOilMl']);
  return {
    costs,
    lowConcentrateMl: s['stock.lowConcentrateMl'],
    lowOilMl: s['stock.lowOilMl'],
    withValue,
  };
}

/** The smallest bottle the shop sells: the low-concentrate warning's «none» is «can't fill one». */
const SMALLEST_SOLD_ML = Math.min(...VOLUMES_ML);

/**
 * One fragrance's stock as the panel shows it (ADR 0043): the ready concentrate, its reserve and
 * what is free, the bottles that fills per sold volume, the oil in grams and ml with their levels,
 * and for the owner the stock at cost: the oil at the average landed price of its standing oil
 * receipts, the concentrate at the cost model's liquid per ml (unknown without an oil price).
 */
export function fragranceStock(
  f: { id: number; oilMg: number; oilPrice: number | null; concentrateUl: number },
  reservedUl: number,
  soldMls: readonly number[],
  receipts: readonly OilReceiptPrice[],
  ctx: StockContext,
  /** Draft oil receipts waiting for the owner (#78). */
  drafts = 0,
): FragranceStock {
  const l = ctx.costs.liquid;
  const freeUl = available(f.concentrateUl, reservedUl);
  const oilMl = oilMlOf(gramsFromMg(f.oilMg), l);
  let value: FragranceStock['value'] = null;
  if (ctx.withValue) {
    const oil = oilValue(f.oilMg, receipts);
    const concentrate =
      f.concentrateUl === 0
        ? 0
        : f.oilPrice === null
          ? null
          : Math.round(concentrateCost(f.oilPrice, mlFromUl(f.concentrateUl), ctx.costs));
    value = { oil, concentrate, total: concentrate === null ? null : oil + concentrate };
  }
  return {
    fragranceId: f.id,
    concentrateMl: mlFromUl(f.concentrateUl),
    reservedMl: mlFromUl(reservedUl),
    availableMl: mlFromUl(freeUl),
    belowReserve: belowReserve(f.concentrateUl, reservedUl),
    level: concentrateLevel(freeUl, fillUl(SMALLEST_SOLD_ML, l), ctx.lowConcentrateMl),
    bottles: [...soldMls]
      .sort((a, b) => a - b)
      .map((ml) => ({ ml, available: bottlesOf(freeUl, fillUl(ml, l)) })),
    oilGrams: gramsFromMg(f.oilMg),
    oilMl: round3(oilMl),
    oilLevel: stockLevelOf(oilMl, ctx.lowOilMl),
    value,
    drafts,
  };
}

/** The stock of several fragrances (the stock page, the export), in four reads. */
export async function fragranceStocks(
  tx: DbOrTx,
  ids: readonly number[],
  ctx: StockContext,
): Promise<Map<number, FragranceStock>> {
  if (ids.length === 0) return new Map();
  const list = [...ids];
  const rows = await tx
    .select({
      id: fragrances.id,
      oilMg: fragrances.oilMg,
      oilPrice: fragrances.oilPrice,
      concentrateUl: fragrances.concentrateUl,
    })
    .from(fragrances)
    .where(inArray(fragrances.id, list));
  const stock = await readLiquidStock(tx, list);
  const vols = await tx
    .select({ fragranceId: volumes.fragranceId, ml: volumes.ml })
    .from(volumes)
    .where(and(inArray(volumes.fragranceId, list), sellableVolume()));
  const live = await tx
    .select({
      fragranceId: oilReceipts.fragranceId,
      draft: oilReceipts.draft,
      oilMg: oilReceipts.oilMg,
      pricePerGram: oilReceipts.pricePerGram,
      discountPercent: oilReceipts.discountPercent,
      importPercent: oilReceipts.importPercent,
    })
    .from(oilReceipts)
    .where(and(inArray(oilReceipts.fragranceId, list), isNull(oilReceipts.voidedAt)));
  return new Map(
    rows.map((f) => [
      f.id,
      fragranceStock(
        f,
        stock.of(f.id).reservedUl,
        vols.filter((v) => v.fragranceId === f.id).map((v) => v.ml),
        ctx.withValue ? live.filter((r) => r.fragranceId === f.id && !r.draft) : [],
        ctx,
        ctx.withValue ? live.filter((r) => r.fragranceId === f.id && r.draft).length : 0,
      ),
    ]),
  );
}

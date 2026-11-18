import type { FragranceOil } from '@lummi/contracts';
import { and, fragrances, inArray, isNull, oilReceipts, volumes, type DbOrTx } from '@lummi/db';
import { readCostSettings } from '../cost/cost-settings';
import { bottleCost, isBottleMl, liquidFromOil, type CostSettings } from '../cost/unit-cost';
import { readSettings } from '../settings/settings.service';
import { gramsFromMg, oilLevel, oilValue, type ReceiptPrice } from './oil';

/** Grams and litres go out to three decimals: a milligram, a millilitre. */
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** What every oil summary needs, read once per request. */
export interface OilContext {
  costs: CostSettings;
  /** The `stock.lowOilLitres` setting. */
  lowOilLitres: number;
  /** The owner sees stock values; a manager does not (ADR 0041). */
  withValue: boolean;
}

export async function readOilContext(tx: DbOrTx, withValue: boolean): Promise<OilContext> {
  const costs = await readCostSettings(tx);
  const { 'stock.lowOilLitres': lowOilLitres } = await readSettings(tx, ['stock.lowOilLitres']);
  return { costs, lowOilLitres, withValue };
}

/**
 * One fragrance's oil as the panel shows it: the balance, the litres of perfume it still makes
 * (the cost model's formula read backwards), the low-oil level, and for the owner the stock at
 * cost: the oil at the average landed price of its standing receipts, the bottles on hand at
 * their unit cost (unknown without an oil price).
 */
export function fragranceOil(
  f: { id: number; oilMg: number; oilPrice: number | null },
  receipts: readonly ReceiptPrice[],
  vols: readonly { ml: number; onHand: number }[],
  ctx: OilContext,
): FragranceOil {
  const litres = liquidFromOil(gramsFromMg(f.oilMg), ctx.costs.liquid) / 1000;
  let value: FragranceOil['value'] = null;
  if (ctx.withValue) {
    const oil = oilValue(f.oilMg, receipts);
    const counted = vols.filter((v) => v.onHand > 0);
    const bottles =
      counted.length === 0
        ? 0
        : f.oilPrice === null
          ? null
          : counted.reduce(
              (a, v) =>
                a +
                (isBottleMl(v.ml) ? bottleCost(f.oilPrice!, v.ml, ctx.costs).total : 0) * v.onHand,
              0,
            );
    value = { oil, bottles, total: bottles === null ? null : oil + bottles };
  }
  return {
    fragranceId: f.id,
    oilGrams: gramsFromMg(f.oilMg),
    liquidLitres: round3(litres),
    level: oilLevel(litres, ctx.lowOilLitres),
    value,
  };
}

/** The oil of several fragrances (the stock page, the export), in three reads. */
export async function fragranceOils(
  tx: DbOrTx,
  ids: readonly number[],
  ctx: OilContext,
): Promise<Map<number, FragranceOil>> {
  if (ids.length === 0) return new Map();
  const list = [...ids];
  const rows = await tx
    .select({ id: fragrances.id, oilMg: fragrances.oilMg, oilPrice: fragrances.oilPrice })
    .from(fragrances)
    .where(inArray(fragrances.id, list));
  const receipts = ctx.withValue
    ? await tx
        .select({
          fragranceId: oilReceipts.fragranceId,
          oilMg: oilReceipts.oilMg,
          pricePerGram: oilReceipts.pricePerGram,
          discountPercent: oilReceipts.discountPercent,
          importPercent: oilReceipts.importPercent,
        })
        .from(oilReceipts)
        .where(and(inArray(oilReceipts.fragranceId, list), isNull(oilReceipts.voidedAt)))
    : [];
  const vols = ctx.withValue
    ? await tx
        .select({ fragranceId: volumes.fragranceId, ml: volumes.ml, onHand: volumes.onHand })
        .from(volumes)
        .where(inArray(volumes.fragranceId, list))
    : [];
  return new Map(
    rows.map((f) => [
      f.id,
      fragranceOil(
        f,
        receipts.filter((r) => r.fragranceId === f.id),
        vols.filter((v) => v.fragranceId === f.id),
        ctx,
      ),
    ]),
  );
}

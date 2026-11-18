import { settingDefinitions, type SettingKey, type UnitCost } from '@lummi/contracts';

/**
 * The cost model (ADR 0040): the customer's cost calculator, as pure functions. Every caller (the
 * catalog page, bottling #76, order profit #77, the planner #78, the 5 ml set and gift sample #79)
 * comes here with the settings read once (`readCostSettings`) and a fragrance's oil price.
 *
 * Rounding, stated once (`som`): the arithmetic is the calculator's own on unrounded numbers, one
 * formula for every filled bottle (`vial`); each figure of the result is then rounded to whole so'm,
 * half up, exactly as the calculator shows it. `total` is the unrounded total rounded, so the
 * rounded parts can differ from it by a so'm or two.
 */

/** A bottle size the cost is known for: 5 ml exists for sets and samples only (#79). */
export type BottleMl = 5 | 10 | 30 | 50;
/** The vial size of a set: Discovery Set 5 × 5 ml or 5 × 10 ml. */
export type SetVialMl = 5 | 10;

export interface LiquidSettings {
  /** So'm per $1. */
  usdRate: number;
  oilPercent: number;
  ethanolPercent: number;
  oilDiscountPercent: number;
  /** So'm per litre of perfume ethanol, already discounted. */
  ethanolPerLitre: number;
  /** Grams per ml of oil. */
  oilDensity: number;
  /** So'm per ml of perfume. */
  fixativePerMl: number;
  fillingLossPercent: number;
  /** Delivery of the oil to Termez, percent of its discounted price. */
  oilImportPercent: number;
}
export interface PackagingSettings {
  bottle: Record<BottleMl, number>;
  label: number;
  spray: number;
  /** The filling work, per bottle. */
  filling: number;
  /** A 5 ml bottle has no box. */
  box: Record<Exclude<BottleMl, 5>, number>;
  setBox: Record<SetVialMl, number>;
  /** The QR card: one per 10/30/50 ml bottle and one per set. */
  insert: number;
  defectPercent: number;
}
export interface OrderCostSettings {
  mailer: number;
  btsCharge: number;
  adPerSale: number;
  taxPercent: number;
  onlinePaymentPercent: number;
  uzumCommissionPercent: number;
  giftSampleCount: number;
  giftSampleMl: number;
}
export interface CostSettings {
  liquid: LiquidSettings;
  packaging: PackagingSettings;
  order: OrderCostSettings;
}

/** Every setting the cost model reads, in one list for one query. */
export const COST_SETTING_KEYS = [
  'cost.liquid.usdRate',
  'cost.liquid.oilPercent',
  'cost.liquid.ethanolPercent',
  'cost.liquid.oilDiscountPercent',
  'cost.liquid.ethanolPerLitre',
  'cost.liquid.oilDensity',
  'cost.liquid.fixativePerMl',
  'cost.liquid.fillingLossPercent',
  'cost.liquid.oilImportPercent',
  'cost.packaging.bottle5Ml',
  'cost.packaging.bottle10Ml',
  'cost.packaging.bottle30Ml',
  'cost.packaging.bottle50Ml',
  'cost.packaging.label',
  'cost.packaging.spray',
  'cost.packaging.filling',
  'cost.packaging.box10Ml',
  'cost.packaging.box30Ml',
  'cost.packaging.box50Ml',
  'cost.packaging.setBox5Ml',
  'cost.packaging.setBox10Ml',
  'cost.packaging.insert',
  'cost.packaging.defectPercent',
  'cost.order.mailer',
  'cost.order.btsCharge',
  'cost.order.adPerSale',
  'cost.order.taxPercent',
  'cost.order.onlinePaymentPercent',
  'cost.order.uzumCommissionPercent',
  'cost.order.giftSampleCount',
  'cost.order.giftSampleMl',
] as const satisfies readonly SettingKey[];
export type CostSettingKey = (typeof COST_SETTING_KEYS)[number];

/** The one mapping from the settings store's keys to the model's shape. */
export function costSettingsFrom(v: Record<CostSettingKey, number>): CostSettings {
  return {
    liquid: {
      usdRate: v['cost.liquid.usdRate'],
      oilPercent: v['cost.liquid.oilPercent'],
      ethanolPercent: v['cost.liquid.ethanolPercent'],
      oilDiscountPercent: v['cost.liquid.oilDiscountPercent'],
      ethanolPerLitre: v['cost.liquid.ethanolPerLitre'],
      oilDensity: v['cost.liquid.oilDensity'],
      fixativePerMl: v['cost.liquid.fixativePerMl'],
      fillingLossPercent: v['cost.liquid.fillingLossPercent'],
      oilImportPercent: v['cost.liquid.oilImportPercent'],
    },
    packaging: {
      bottle: {
        5: v['cost.packaging.bottle5Ml'],
        10: v['cost.packaging.bottle10Ml'],
        30: v['cost.packaging.bottle30Ml'],
        50: v['cost.packaging.bottle50Ml'],
      },
      label: v['cost.packaging.label'],
      spray: v['cost.packaging.spray'],
      filling: v['cost.packaging.filling'],
      box: {
        10: v['cost.packaging.box10Ml'],
        30: v['cost.packaging.box30Ml'],
        50: v['cost.packaging.box50Ml'],
      },
      setBox: { 5: v['cost.packaging.setBox5Ml'], 10: v['cost.packaging.setBox10Ml'] },
      insert: v['cost.packaging.insert'],
      defectPercent: v['cost.packaging.defectPercent'],
    },
    order: {
      mailer: v['cost.order.mailer'],
      btsCharge: v['cost.order.btsCharge'],
      adPerSale: v['cost.order.adPerSale'],
      taxPercent: v['cost.order.taxPercent'],
      onlinePaymentPercent: v['cost.order.onlinePaymentPercent'],
      uzumCommissionPercent: v['cost.order.uzumCommissionPercent'],
      giftSampleCount: v['cost.order.giftSampleCount'],
      giftSampleMl: v['cost.order.giftSampleMl'],
    },
  };
}

/** The registry's defaults (the calculator's `P0`), for tests and tools. */
export function defaultCostSettings(): CostSettings {
  return costSettingsFrom(
    Object.fromEntries(
      COST_SETTING_KEYS.map((k) => [k, settingDefinitions[k].default]),
    ) as Record<CostSettingKey, number>,
  );
}

/**
 * The one rounding rule of the model: unrounded so'm to whole so'm, half up, as the calculator
 * shows its figures. Every cost figure that leaves this module passes through it once.
 */
export const som = (x: number): number => Math.round(x);

const BOTTLE_MLS: readonly number[] = [5, 10, 30, 50] satisfies BottleMl[];
/** A volume the model knows a bottle for. */
export const isBottleMl = (ml: number): ml is BottleMl => BOTTLE_MLS.includes(ml);

/**
 * Oil so'm per gram after the supplier discount and delivery to Termez (calculator `oilG`). An oil
 * receipt (#76) passes its own discount and import percent.
 */
export function landedOilPrice(
  oilPrice: number,
  l: Pick<LiquidSettings, 'oilDiscountPercent' | 'oilImportPercent'>,
): number {
  return oilPrice * (1 - l.oilDiscountPercent / 100) * (1 + l.oilImportPercent / 100);
}

/** Ml of perfume a fill of `ml` uses up, the filling loss included. */
const filled = (ml: number, l: LiquidSettings) => ml * (1 + l.fillingLossPercent / 100);
/** Ml of oil in `liquidMl` of perfume. The cost and the consumption both read it. */
const oilShare = (liquidMl: number, l: LiquidSettings) => (liquidMl * l.oilPercent) / 100;
/** Ethanol and fixative, so'm per ml of perfume, before the filling loss. */
const ethanolPerMl = (l: LiquidSettings) =>
  ((l.ethanolPerLitre / 1000) * l.ethanolPercent) / 100 + l.fixativePerMl;

/**
 * What filling `ml` of perfume uses up, the filling loss included: grams of oil and ml of ethanol
 * (unrounded). The oil part of a bottle's cost is these grams at the landed price.
 */
export function liquidNeeded(ml: number, l: LiquidSettings): { oilGrams: number; ethanolMl: number } {
  const liquid = filled(ml, l);
  return {
    oilGrams: oilShare(liquid, l) * l.oilDensity,
    ethanolMl: (liquid * l.ethanolPercent) / 100,
  };
}

/**
 * The ml of perfume `oilGrams` of oil can still be bottled into (unrounded): `liquidNeeded` read
 * backwards, so the warehouse's litres are what a bottling can use (ADR 0041). The calculator's
 * planner (`buyCalc`) takes the loss off as × (1 − loss) instead; the two differ by about 0.1 %.
 */
export function liquidFromOil(oilGrams: number, l: LiquidSettings): number {
  return oilGrams / l.oilDensity / (l.oilPercent / 100) / (1 + l.fillingLossPercent / 100);
}

type Parts = Omit<UnitCost, 'base' | 'defect' | 'total'>;
type VialParts = Omit<Parts, 'box' | 'insert'>;

/**
 * One filled bottle without its box and card (calculator `vial`): liquid, bottle, label, spray,
 * filling work; unrounded. A bottle, a set's vials and a sample are all built from it.
 */
function vial(oilPrice: number, ml: BottleMl, s: CostSettings): VialParts {
  const { liquid: l, packaging: p } = s;
  /** So'm per ml of oil. */
  const oilPerMl = landedOilPrice(oilPrice, l) * l.oilDensity;
  const liquid = filled(ml, l);
  return {
    oil: oilPerMl * oilShare(liquid, l),
    ethanol: ethanolPerMl(l) * liquid,
    bottle: p.bottle[ml],
    label: p.label,
    spray: p.spray,
    filling: p.filling,
  };
}

/**
 * The cost of one bottle of a fragrance (calculator `unit`): the filled bottle (`vial`) plus its
 * box and QR card (neither for 5 ml), then the defect percent on the whole. `oilPrice` is so'm per
 * gram before the supplier discount.
 */
export function bottleCost(oilPrice: number, ml: BottleMl, s: CostSettings): UnitCost {
  const p = s.packaging;
  return withDefect(
    {
      ...vial(oilPrice, ml, s),
      box: ml === 5 ? 0 : p.box[ml],
      insert: ml === 5 ? 0 : p.insert,
    },
    p.defectPercent,
  );
}

/**
 * The cost of one gift sample (calculator `giftCost`): the average 5 ml vial over the given
 * fragrances, its liquid scaled to the sample's ml, the defect percent on each, plus one QR card.
 * Null with no fragrance to average over.
 */
export function giftSampleCost(oilPrices: readonly number[], s: CostSettings): number | null {
  if (oilPrices.length === 0) return null;
  const ml = s.order.giftSampleMl;
  const defect = 1 + s.packaging.defectPercent / 100;
  const sum = oilPrices.reduce((a, price) => {
    const v = vial(price, 5, s);
    const liquid = ((v.oil + v.ethanol) / 5) * ml;
    return a + (liquid + v.bottle + v.label + v.spray + v.filling) * defect;
  }, 0);
  return som(sum / oilPrices.length + s.packaging.insert);
}

/**
 * The cost of a set (calculator `setUnit`): its vials (one per fragrance, in `oilPrices`, each
 * without a box or card of its own) plus the set box and one QR card, then the defect percent.
 */
export function setCost(oilPrices: readonly number[], ml: SetVialMl, s: CostSettings): UnitCost {
  const parts = oilPrices.map((price) => vial(price, ml, s));
  const sum = (k: keyof VialParts) => parts.reduce((a, p) => a + p[k], 0);
  return withDefect(
    {
      oil: sum('oil'),
      ethanol: sum('ethanol'),
      bottle: sum('bottle'),
      label: sum('label'),
      spray: sum('spray'),
      filling: sum('filling'),
      box: s.packaging.setBox[ml],
      insert: s.packaging.insert,
    },
    s.packaging.defectPercent,
  );
}

function withDefect(r: Parts, defectPercent: number): UnitCost {
  const base = r.oil + r.ethanol + r.bottle + r.label + r.spray + r.filling + r.box + r.insert;
  const defect = (base * defectPercent) / 100;
  return {
    oil: som(r.oil),
    ethanol: som(r.ethanol),
    bottle: som(r.bottle),
    label: som(r.label),
    spray: som(r.spray),
    filling: som(r.filling),
    box: som(r.box),
    insert: som(r.insert),
    base: som(base),
    defect: som(defect),
    total: som(base + defect),
  };
}

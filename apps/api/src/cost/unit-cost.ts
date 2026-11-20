import {
  settingDefinitions,
  type SalesChannel,
  type SettingKey,
  type UnitCost,
} from '@lummi/contracts';

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
    Object.fromEntries(COST_SETTING_KEYS.map((k) => [k, settingDefinitions[k].default])) as Record<
      CostSettingKey,
      number
    >,
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

/** Microlitres in a millilitre: the ready concentrate is kept in whole µl (ADR 0043). */
export const UL_PER_ML = 1000;

/**
 * One bottle's fill of ready concentrate (ADR 0043), whole µl: its ml with the filling loss, the
 * liquid `bottleCost` costs. The reserve, the handover and every available count take this.
 */
export function fillUl(ml: number, l: LiquidSettings): number {
  return Math.round(filled(ml, l) * UL_PER_ML);
}

/**
 * What mixing `ml` of ready concentrate takes (ADR 0043), unrounded: grams of oil and ml of ethanol
 * by the cost model's shares, without the filling loss (each bottle's fill counts that).
 */
export function mixNeeds(ml: number, l: LiquidSettings): { oilGrams: number; ethanolMl: number } {
  return {
    oilGrams: oilShare(ml, l) * l.oilDensity,
    ethanolMl: (ml * l.ethanolPercent) / 100,
  };
}

/**
 * What filling `ml` of perfume uses up, the filling loss included: grams of oil and ml of ethanol
 * (unrounded). The oil part of a bottle's cost is these grams at the landed price.
 */
export function liquidNeeded(ml: number, l: LiquidSettings): { oilGrams: number; ethanolMl: number } {
  return mixNeeds(filled(ml, l), l);
}

/**
 * Ml of ready concentrate at cost, unrounded (ADR 0043): its oil at the landed oil price and its
 * ethanol with the fixative, no loss, no packaging. The stock value counts the concentrate at it.
 */
export function concentrateCost(oilPrice: number, ml: number, s: CostSettings): number {
  const l = s.liquid;
  return landedOilPrice(oilPrice, l) * l.oilDensity * oilShare(ml, l) + ethanolPerMl(l) * ml;
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
  return withDefect(bottleParts(oilPrice, ml, s), s.packaging.defectPercent);
}

function bottleParts(oilPrice: number, ml: BottleMl, s: CostSettings): Parts {
  const p = s.packaging;
  return {
    ...vial(oilPrice, ml, s),
    box: ml === 5 ? 0 : p.box[ml],
    insert: ml === 5 ? 0 : p.insert,
  };
}

/**
 * The same bottle as `bottleCost`, unrounded, for a caller that multiplies it by thousands of
 * bottles (the planner, #78): `liquid` is oil plus ethanol, `total` includes the defect percent.
 */
export function bottleCostExact(
  oilPrice: number,
  ml: BottleMl,
  s: CostSettings,
): { liquid: number; total: number } {
  const r = bottleParts(oilPrice, ml, s);
  return {
    liquid: r.oil + r.ethanol,
    total: sumWithDefect(r, s.packaging.defectPercent).total,
  };
}

/**
 * The cost of one gift sample (calculator `giftCost`): the average 5 ml vial over the given
 * fragrances, its liquid scaled to the sample's ml, the defect percent on each, plus one QR card.
 * Null with no fragrance to average over.
 */
export function giftSampleCost(oilPrices: readonly number[], s: CostSettings): number | null {
  const exact = giftSampleCostExact(oilPrices, s);
  return exact === null ? null : som(exact);
}

/** `giftSampleCost` before rounding, for a caller that multiplies it by the sample count. */
export function giftSampleCostExact(oilPrices: readonly number[], s: CostSettings): number | null {
  if (oilPrices.length === 0) return null;
  const ml = s.order.giftSampleMl;
  const defect = 1 + s.packaging.defectPercent / 100;
  const sum = oilPrices.reduce((a, price) => {
    const v = vial(price, 5, s);
    const liquid = ((v.oil + v.ethanol) / 5) * ml;
    return a + (liquid + v.bottle + v.label + v.spray + v.filling) * defect;
  }, 0);
  return sum / oilPrices.length + s.packaging.insert;
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

/** The sum of a cost's parts and the defect percent on it, unrounded: the one place both are worked out. */
export function sumWithDefect(
  r: Parts,
  defectPercent: number,
): { base: number; defect: number; total: number } {
  const base = r.oil + r.ethanol + r.bottle + r.label + r.spray + r.filling + r.box + r.insert;
  const defect = (base * defectPercent) / 100;
  return { base, defect, total: base + defect };
}

function withDefect(r: Parts, defectPercent: number): UnitCost {
  const { base, defect, total } = sumWithDefect(r, defectPercent);
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
    total: som(total),
  };
}

/**
 * One order's Order costs part by part (GLOSSARY: what it costs besides its goods), its whole cost
 * and its profit, unrounded.
 */
export interface OrderCostParts {
  mailer: number;
  /** BTS charge less what the customer pays for delivery below the free-delivery threshold. */
  delivery: number;
  /** Online-payment percent (Mini App) or the Uzum commission. */
  commission: number;
  ad: number;
  tax: number;
  gift: number;
  /** Everything the order costs the shop: its goods plus every cost above. */
  cost: number;
  profit: number;
  /** Profit over revenue; 0 without revenue, as the calculator has it. */
  margin: number;
}

/**
 * The costs of one order and its profit (calculator `orderCosts`), unrounded. `goods` is the
 * unit cost total of what it holds, `giftSample` the cost of a gift sample added to it (0: none).
 * `delivery` is pricing's: the free-delivery threshold and what the customer pays below it.
 */
export function orderCosts(a: {
  revenue: number;
  goods: number;
  /** The Mini App (mailer, BTS delivery, online payment) or Uzum (its commission). */
  channel: SalesChannel;
  giftSample?: number;
  delivery: { freeFrom: number; customerFee: number };
  settings: CostSettings;
}): OrderCostParts {
  const { revenue, goods, channel, settings: s } = a;
  const o = s.order;
  const app = channel === 'miniapp';
  const mailer = app ? o.mailer : 0;
  const delivery = app
    ? o.btsCharge - (revenue < a.delivery.freeFrom ? a.delivery.customerFee : 0)
    : 0;
  const commission = (revenue * (app ? o.onlinePaymentPercent : o.uzumCommissionPercent)) / 100;
  const ad = o.adPerSale;
  const tax = (revenue * o.taxPercent) / 100;
  const gift = a.giftSample ?? 0;
  const cost = goods + mailer + delivery + commission + ad + tax + gift;
  const profit = revenue - cost;
  return {
    mailer,
    delivery,
    commission,
    ad,
    tax,
    gift,
    cost,
    profit,
    margin: revenue ? profit / revenue : 0,
  };
}

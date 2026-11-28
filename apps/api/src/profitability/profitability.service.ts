import {
  PROFITABILITY_VOLUMES,
  SET_SIZE,
  MAIN_SET_KEY,
  SET_VIAL_ML,
  type ProfitabilityQuote,
  type ProfitabilityQuoteBody,
  type ProfitabilityRow,
  type ProfitabilitySummary,
  type ProfitabilityTable,
  type ProfitabilityVolume,
  type SalesChannel,
  type UnitCost,
} from '@lummi/contracts';
import {
  asc,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  sellableVolume,
  volumes,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import type { Language } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { readCostSettings } from '../cost/cost-settings';
import {
  bottleCost,
  giftSampleCost,
  isBottleMl,
  setCost,
  type CostSettings,
} from '../cost/unit-cost';
import type { Edges } from '../edges';
import { readPricingSettings } from '../pricing/pricing-settings';
import { roundedAverage } from '../reports/report-range';
import { volumePrice } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { costSale, type SaleContext, type SaleLine } from './cost-sale';
import { profitabilityWorkbook } from './profitability-workbook';

export interface ProfitabilityView {
  channel: SalesChannel;
  afterSetDiscount: boolean;
  giftSample: boolean;
}

/** The shop as the page reads it: fragrances with their volumes and oil prices, the set, the settings. */
interface Shop {
  fragrances: {
    id: number;
    name: string;
    brand: string;
    hidden: boolean;
    oilPrice: number | null;
    volumes: { ml: number; price: number; salePrice: number | null; saleEndsAt: Date | null }[];
  }[];
  set: { price: number; fragranceIds: number[] } | null;
  cost: CostSettings;
  pricing: SaleContext['pricing'];
  deliveryTariff: number;
  afterSetPercent: number;
  lowMarginPercent: number;
  /** One gift sample: the average 5 ml vial over every fragrance with an oil price. */
  giftSample: number | null;
}

/**
 * «Рентабельность» (#77), owner only: the table of one sale of each fragrance's volume and of the
 * Discovery set, the calculator and the order simulator. Each sale is `costSale` (the shop's own
 * pricing, then the calculator's order costs) on the unit costs of the cost model (ADR 0040), all
 * read in one snapshot; the page only shows what this computes.
 */
@Injectable()
export class Profitability {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  async table(view: ProfitabilityView): Promise<ProfitabilityTable> {
    const shop = await this.shop();
    const ctx = this.context(shop, view);
    const unknownGift = giftUnknown(shop, view);
    const rows: ProfitabilityRow[] = [];
    for (const f of shop.fragrances) {
      for (const v of f.volumes) {
        const line: SaleLine = {
          item: { kind: 'volume', fragranceId: f.id, ml: v.ml },
          name: f.name,
          brand: f.brand,
          ml: v.ml,
          qty: 1,
          price: volumePrice(v),
          unitCost: bottleUnitCost(f.oilPrice, v.ml, shop.cost),
        };
        rows.push(this.row(line, f.hidden, ctx, shop, unknownGift));
      }
    }
    const set = setLine(shop);
    if (set) rows.push(this.row(set, false, ctx, shop, unknownGift));
    return {
      channel: view.channel,
      afterSetDiscount: view.afterSetDiscount,
      giftSample: view.giftSample,
      afterSetDiscountPercent: shop.afterSetPercent,
      lowMarginPercent: shop.lowMarginPercent,
      giftSampleCost: shop.giftSample,
      rows,
      summaries: PROFITABILITY_VOLUMES.map((volume) => summaryOf(volume, rows)),
      set: { size: SET_SIZE, vialMl: SET_VIAL_ML },
    };
  }

  /** The calculator and the simulator; null when a line names no such fragrance, volume or set. */
  async quote(body: ProfitabilityQuoteBody): Promise<ProfitabilityQuote | null> {
    const shop = await this.shop();
    const lines: SaleLine[] = [];
    const missing = new Set<string>();
    for (const { item, qty } of body.lines) {
      if (item.kind === 'discovery_set') {
        const set = setLine(shop);
        if (!set) return null;
        for (const id of shop.set!.fragranceIds) {
          const f = shop.fragrances.find((x) => x.id === id);
          if (f && f.oilPrice === null) missing.add(f.name);
        }
        lines.push({ ...set, qty });
        continue;
      }
      const f = shop.fragrances.find((x) => x.id === item.fragranceId);
      const v = f?.volumes.find((x) => x.ml === item.ml);
      if (!f || !v) return null;
      if (f.oilPrice === null) missing.add(f.name);
      lines.push({
        item,
        name: f.name,
        brand: f.brand,
        ml: v.ml,
        qty,
        price: volumePrice(v),
        unitCost: bottleUnitCost(f.oilPrice, v.ml, shop.cost),
      });
    }
    const ctx = this.context(shop, body);
    const sale = costSale(lines, ctx);
    return {
      lines: sale.lines.map((l) => ({
        item: l.item,
        name: l.name,
        brand: l.brand,
        ml: l.ml,
        qty: l.qty,
        unitPrice: l.unitPrice,
        regularUnitPrice: l.price.regular,
        markedDown: l.markedDown,
        lineTotal: l.lineTotal,
        unitCost: l.unitCost,
      })),
      itemsSubtotal: sale.itemsSubtotal,
      discount: sale.discount,
      afterSetDiscountPercent: shop.afterSetPercent,
      deliveryFee: sale.deliveryFee,
      freeDeliveryThreshold: shop.pricing.freeDeliveryThreshold,
      amountToFreeDelivery: sale.amountToFreeDelivery,
      profit: giftUnknown(shop, body) ? null : sale.profit,
      missing: [...missing].sort(),
    };
  }

  async workbook(view: ProfitabilityView, language: Language): Promise<Buffer> {
    return profitabilityWorkbook(await this.table(view), language);
  }

  private context(shop: Shop, view: ProfitabilityView): SaleContext {
    return {
      channel: view.channel,
      afterSetDiscountPercent: view.afterSetDiscount ? shop.afterSetPercent : null,
      giftSample: view.giftSample ? shop.giftSample : null,
      deliveryTariff: shop.deliveryTariff,
      pricing: shop.pricing,
      cost: shop.cost,
      now: this.edges.clock.now(),
    };
  }

  /** One sale's row; `unknownGift`: a gift sample is asked for but has no cost, so neither has the sale. */
  private row(
    line: SaleLine,
    hidden: boolean,
    ctx: SaleContext,
    shop: Shop,
    unknownGift: boolean,
  ): ProfitabilityRow {
    const sale = costSale([line], ctx);
    const priced = sale.lines[0]!;
    const sold = unknownGift ? null : sale.profit;
    const profit = sold?.profit ?? null;
    const margin = sold?.margin ?? null;
    return {
      kind: line.item.kind,
      fragranceId: line.item.kind === 'volume' ? line.item.fragranceId : null,
      name: line.item.kind === 'volume' ? line.name : '',
      brand: line.brand,
      ml: line.ml,
      hidden,
      price: priced.unitPrice,
      markedDown: priced.markedDown,
      discount: sale.discount,
      unitCost: line.unitCost?.total ?? null,
      orderCosts: sold ? sold.cost - sold.goods : null,
      profit,
      margin,
      flag:
        profit === null
          ? null
          : profit < 0
            ? 'loss'
            : margin !== null && margin * 100 < shop.lowMarginPercent
              ? 'low'
              : null,
    };
  }

  /** Everything the page computes from, in one read-only snapshot. */
  private shop(): Promise<Shop> {
    return this.db.transaction((tx) => readShop(tx), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  }
}

/** One bottle at unit cost (ADR 0040); null without an oil price. */
function bottleUnitCost(oilPrice: number | null, ml: number, s: CostSettings): UnitCost | null {
  return oilPrice !== null && isBottleMl(ml) ? bottleCost(oilPrice, ml, s) : null;
}

/** A volume filter's figures: its rows, their average profit (`roundedAverage`) and the marks. */
function summaryOf(volume: ProfitabilityVolume, all: ProfitabilityRow[]): ProfitabilitySummary {
  const rows = all.filter((r) =>
    volume === 'all'
      ? true
      : volume === 'set'
        ? r.kind === 'discovery_set'
        : r.kind === 'volume' && String(r.ml) === volume,
  );
  const known = rows.flatMap((r) => (r.profit === null ? [] : [r.profit]));
  return {
    volume,
    rows: rows.length,
    averageProfit: roundedAverage(
      known.reduce((a, b) => a + b, 0),
      known.length,
    ),
    loss: rows.filter((r) => r.flag === 'loss').length,
    low: rows.filter((r) => r.flag === 'low').length,
    noOil: rows.filter((r) => r.unitCost === null).length,
  };
}

/** The gift sample is asked for but costs nothing known (no fragrance has an oil price). */
function giftUnknown(shop: Shop, view: { giftSample: boolean }): boolean {
  return view.giftSample && shop.giftSample === null;
}

/** The Discovery set as one sale line; null without the set or its five fragrances. */
function setLine(shop: Shop): SaleLine | null {
  if (!shop.set) return null;
  const prices = shop.set.fragranceIds.map(
    (id) => shop.fragrances.find((f) => f.id === id)?.oilPrice ?? null,
  );
  const known = prices.length === 5 && prices.every((p) => p !== null);
  return {
    item: { kind: 'discovery_set' },
    name: '',
    brand: null,
    ml: SET_VIAL_ML,
    qty: 1,
    price: { regular: shop.set.price, markdown: null },
    unitCost: known ? setCost(prices as number[], SET_VIAL_ML, shop.cost) : null,
  };
}

async function readShop(tx: DbOrTx): Promise<Shop> {
  const rows = await tx
    .select({
      id: fragrances.id,
      name: fragrances.name,
      brand: fragrances.originalBrand,
      hidden: fragrances.hidden,
      oilPrice: fragrances.oilPrice,
    })
    .from(fragrances)
    .orderBy(asc(fragrances.name), asc(fragrances.id));
  const vols = await tx
    .select({
      fragranceId: volumes.fragranceId,
      ml: volumes.ml,
      price: volumes.price,
      salePrice: volumes.salePrice,
      saleEndsAt: volumes.saleEndsAt,
    })
    .from(volumes)
    // what the shop sells: the 5 ml never alone (ADR 0042)
    .where(sellableVolume())
    .orderBy(asc(volumes.ml));
  // the page's set is the main Discovery set, 5 × 10 ml (#77, ADR 0044)
  const [set] = await tx.select().from(discoverySet).where(eq(discoverySet.key, MAIN_SET_KEY));
  const items = await tx
    .select({ fragranceId: discoverySetItems.fragranceId })
    .from(discoverySetItems)
    .where(eq(discoverySetItems.setKey, MAIN_SET_KEY))
    .orderBy(asc(discoverySetItems.position));
  const cost = await readCostSettings(tx);
  const s = await readSettings(tx, [
    'delivery.defaultTariff',
    'upgradeRights.set.percent',
    'cost.order.lowMarginPercent',
  ]);
  const prices = rows.flatMap((r) => (r.oilPrice === null ? [] : [r.oilPrice]));
  return {
    fragrances: rows.map((r) => ({
      ...r,
      volumes: vols.filter((v) => v.fragranceId === r.id),
    })),
    set: set ? { price: set.price, fragranceIds: items.map((i) => i.fragranceId) } : null,
    cost,
    pricing: await readPricingSettings(tx),
    deliveryTariff: s['delivery.defaultTariff'],
    afterSetPercent: s['upgradeRights.set.percent'],
    lowMarginPercent: s['cost.order.lowMarginPercent'],
    giftSample: giftSampleCost(prices, cost),
  };
}

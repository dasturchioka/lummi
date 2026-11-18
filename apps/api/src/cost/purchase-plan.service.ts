import { parsePerFragranceKg, type PurchasePlan, type PurchasePlanQuery } from '@lummi/contracts';
import { asc, fragrances, volumes, type Db } from '@lummi/db';
import type { Language } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { readSettings } from '../settings/settings.service';
import { DB } from '../tokens';
import { readCostSettings } from './cost-settings';
import { planPurchase, PLAN_VOLUMES, type PlanFragrance } from './purchase-plan';
import { purchasePlanWorkbook } from './purchase-plan-workbook';

const PLAN_KEYS = [
  'buy.oilKgPerFragrance',
  'buy.share10Ml',
  'buy.share30Ml',
  'buy.share50Ml',
  'buy.avgDiscountPercent',
  'buy.uzumSharePercent',
  'buy.soldPercent',
  'buy.staffCount',
  'buy.staffSalary',
  'buy.rent',
  'buy.otherUsd',
  'pricing.freeDeliveryThreshold',
  'delivery.defaultTariff',
] as const;

/**
 * The owner's purchase planner (#78): reads the settings and the catalog, hands them to
 * `planPurchase`. The kilograms per fragrance come from `buy.oilKgPerFragrance`, or from the
 * what-if query (`kg` for every fragrance, `by` for single ones); nothing of that is stored.
 */
@Injectable()
export class PurchasePlans {
  constructor(@Inject(DB) private readonly db: Db) {}

  async plan(query: PurchasePlanQuery): Promise<PurchasePlan> {
    const [cost, v] = await Promise.all([
      readCostSettings(this.db),
      readSettings(this.db, PLAN_KEYS),
    ]);
    const defaultKg = query.kg ?? v['buy.oilKgPerFragrance'];
    const own = parsePerFragranceKg(query.by);

    const frs = await this.db
      .select({
        id: fragrances.id,
        name: fragrances.name,
        brand: fragrances.originalBrand,
        oilPrice: fragrances.oilPrice,
      })
      .from(fragrances)
      .orderBy(asc(fragrances.id));
    const vols = await this.db
      .select({ fragranceId: volumes.fragranceId, ml: volumes.ml, price: volumes.price })
      .from(volumes);

    const inPlan: PlanFragrance[] = [];
    const withoutOilPrice: PurchasePlan['withoutOilPrice'] = [];
    for (const f of frs) {
      const oilKg = own.get(f.id) ?? defaultKg;
      if (f.oilPrice === null) {
        if (oilKg > 0) withoutOilPrice.push({ fragranceId: f.id, name: f.name });
        continue;
      }
      if (oilKg <= 0) continue;
      const prices: PlanFragrance['prices'] = {};
      for (const r of vols)
        if (r.fragranceId === f.id && (PLAN_VOLUMES as readonly number[]).includes(r.ml))
          prices[r.ml as 10 | 30 | 50] = r.price;
      inPlan.push({
        id: f.id,
        name: f.name,
        brand: f.brand,
        oilPrice: f.oilPrice,
        prices,
        oilKg,
        overridden: own.has(f.id),
      });
    }
    return planPurchase(
      inPlan,
      {
        shares: { 10: v['buy.share10Ml'], 30: v['buy.share30Ml'], 50: v['buy.share50Ml'] },
        avgDiscountPercent: v['buy.avgDiscountPercent'],
        uzumSharePercent: v['buy.uzumSharePercent'],
        soldPercent: v['buy.soldPercent'],
        staffCount: v['buy.staffCount'],
        staffSalary: v['buy.staffSalary'],
        rent: v['buy.rent'],
        otherUsdPerMonth: v['buy.otherUsd'],
        freeDeliveryThreshold: v['pricing.freeDeliveryThreshold'],
        customerDeliveryFee: v['delivery.defaultTariff'],
      },
      cost,
      defaultKg,
      withoutOilPrice,
    );
  }

  async workbook(query: PurchasePlanQuery, language: Language): Promise<Buffer> {
    return purchasePlanWorkbook(await this.plan(query), language);
  }
}

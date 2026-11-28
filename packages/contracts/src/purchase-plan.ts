import { z } from 'zod';
import { languageSchema } from './auth';

/*
 * The purchase planner «Закупка и оборот» (#78, ADR 0040): the customer's calculator page
 * (`buyCalc`) computed by the API from the cost settings, the `buy.*` settings and the catalog.
 * Amounts are whole so'm, each figure rounded on its own; the admin only shows them.
 */

const som = z.number().int();
const count = z.number().int().nonnegative();

/** A fragrance's own kilograms of oil, in the query: `12:2.5,40:0` (fragrance id, kg). */
const PER_FRAGRANCE_KG = /^(\d+:\d+(\.\d+)?)(,\d+:\d+(\.\d+)?)*$/;

/**
 * What-if inputs for one calculation, none stored: `kg` replaces the default kilograms of oil for
 * every fragrance (`buy.oilKgPerFragrance`), `by` gives single fragrances their own. Without
 * them the plan is the settings'.
 */
export const purchasePlanQuerySchema = z.object({
  kg: z.coerce.number().min(0).max(1000).optional(),
  by: z.string().max(4000).regex(PER_FRAGRANCE_KG).optional(),
});
export type PurchasePlanQuery = z.input<typeof purchasePlanQuerySchema>;

export const purchasePlanExportQuerySchema = purchasePlanQuerySchema.extend({
  lang: languageSchema.default('ru'),
});

/** Parses `by` into fragrance id -> kg (the last one wins for a repeated id). */
export function parsePerFragranceKg(by: string | undefined): Map<number, number> {
  const out = new Map<number, number>();
  for (const pair of by ? by.split(',') : []) {
    const [id, kg] = pair.split(':');
    out.set(Number(id), Number(kg));
  }
  return out;
}

export const purchasePlanRowSchema = z.object({
  fragranceId: z.number().int(),
  name: z.string(),
  brand: z.string(),
  /** Kilograms of oil bought for this fragrance (the default, or its override). */
  oilKg: z.number(),
  /** True when `oilKg` is the fragrance's own, not the default. */
  overridden: z.boolean(),
  /** The oil at the landed price. */
  oilCost: som,
  bottles: count,
  revenue: som,
  profit: som,
});
export type PurchasePlanRow = z.infer<typeof purchasePlanRowSchema>;

export const purchasePlanSchema = z.object({
  /** The inputs the plan was computed with. */
  inputs: z.object({
    oilKgPerFragrance: z.number(),
    shares: z.object({ ml10: z.number(), ml30: z.number(), ml50: z.number() }),
    avgDiscountPercent: z.number(),
    uzumSharePercent: z.number(),
    soldPercent: z.number(),
    giftSampleCount: count,
    giftSampleMl: z.number(),
    fixedPerMonth: som,
  }),
  /** Fragrances in the plan: those with an oil price and more than 0 kg. */
  fragranceCount: count,
  investment: z.object({ oil: som, ethanol: som, total: som }),
  /** Ml of perfume the oil makes, and the ml that go to gift samples. */
  liquid: z.object({ perfumeMl: som, giftMl: som }),
  bottles: z.object({ ml10: count, ml30: count, ml50: count, total: count }),
  revenue: z.object({ full: som, discount: som, net: som }),
  gift: z.object({ unitCost: som, total: som }),
  /** Profit over the whole purchase after every cost and the gift samples. */
  profit: som,
  /** Profit / net revenue (0.4 = 40 %); null without revenue. */
  margin: z.number().nullable(),
  /** Bottles to sell to earn back the liquid and samples; null: never. */
  payback: z.object({ units: count.nullable(), share: z.number().nullable() }),
  /** The «realistic year»: `soldPercent` of the purchase sold. */
  year: z.object({
    soldBottles: count,
    revenue: som,
    profit: som,
    fixedCosts: som,
    net: som,
    netPerMonth: som,
    stockAtCost: som,
  }),
  rows: z.array(purchasePlanRowSchema),
  /** Fragrances left out for want of an oil price. */
  withoutOilPrice: z.array(z.object({ fragranceId: z.number().int(), name: z.string() })),
});
export type PurchasePlan = z.infer<typeof purchasePlanSchema>;

export const purchasePlanErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden']),
});

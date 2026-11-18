import { z } from 'zod';

/**
 * The cost model (ADR 0040). The API computes; the admin only shows. Every amount is whole so'm,
 * each figure rounded on its own, so the parts may differ from `total` by a so'm or two.
 */
const som = z.number().int();

/** The cost of one bottle or one set, as the customer's calculator breaks it down. */
export const unitCostSchema = z.object({
  /** The oil in the liquid, filling loss included. */
  oil: som,
  /** Ethanol and fixative, filling loss included. */
  ethanol: som,
  bottle: som,
  label: som,
  spray: som,
  /** The filling work. */
  filling: som,
  box: som,
  /** The QR card. */
  insert: som,
  /** Everything above, before the defect percent. */
  base: som,
  /** The defect («брак и бой») percent of the base. */
  defect: som,
  total: som,
});
export type UnitCost = z.infer<typeof unitCostSchema>;

/** One volume of a fragrance on the admin catalog page: its cost against its price. */
export const volumeCostSchema = z.object({
  ml: z.number().int(),
  price: som,
  /** A markdown price while it is active, else null. */
  markdownPrice: som.nullable(),
  /** Null while the fragrance has no oil price. */
  cost: unitCostSchema.nullable(),
  /** Price less the cost total, before any order costs (delivery, ads, tax). */
  profit: som.nullable(),
  /** Profit as a share of the price (0.62 = 62 %). */
  margin: z.number().nullable(),
  markdownProfit: som.nullable(),
  markdownMargin: z.number().nullable(),
});
export type VolumeCost = z.infer<typeof volumeCostSchema>;

export const fragranceCostsSchema = z.object({
  /** So'm per gram on the supplier's invoice, before the discount; null: unknown. */
  oilPrice: som.nullable(),
  /** So'm per gram after the supplier discount and the delivery to Termez. */
  landedOilPrice: som.nullable(),
  volumes: z.array(volumeCostSchema),
});
export type FragranceCosts = z.infer<typeof fragranceCostsSchema>;

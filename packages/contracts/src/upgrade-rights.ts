import { z } from 'zod';
import { upgradeRightSourceSchema } from './quote';

/**
 * An open upgrade right as Profile «Мои скидки» shows it (TZ §3.4: «видны в профиле»; ticket #38).
 * It applies through the cart's quote like any discount; this is what the customer reads.
 */
export const myUpgradeRightSchema = z.object({
  id: z.number().int(),
  source: upgradeRightSourceSchema,
  /** The order that opened it («Набор из заказа № 1042»), so two rights are told apart. */
  sourceOrderNumber: z.number().int(),
  percent: z.number().int(),
  /** A set's right covers any fragrance (setting `entitlements.setDiscountScope`, #79), not only its five. */
  anyFragrance: z.boolean(),
  /**
   * The covered fragrances as bought (a set's five, or the one 10 ml bottle's); `slug` opens the
   * card while the fragrance is on sale, null once it is hidden.
   */
  fragrances: z.array(
    z.object({ name: z.string(), brand: z.string(), slug: z.string().nullable() }),
  ),
  /** The last day it works, Tashkent `YYYY-MM-DD` (through 23:59:59). */
  lastDay: z.string(),
  /** Whole days after today until `lastDay`; 0 on the last day. */
  daysLeft: z.number().int().nonnegative(),
});
export type MyUpgradeRightDto = z.infer<typeof myUpgradeRightSchema>;

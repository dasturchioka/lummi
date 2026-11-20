import { z } from 'zod';
import { BOX_MLS, CONSUMABLE_UNITS, CONSUMABLE_USES, FLACON_MLS } from './constants';
import { STOCK_LEVELS } from './admin-stock';
import { stockMoveSchema, stockReasonSchema } from './warehouse';

/*
 * Consumables («Расходники» / «Sarf materiallari», ADR 0043): flacons, boxes, the ethanol and
 * whatever else staff count, each with its own count. A bottle filled at handover takes its flacon
 * and box, a set assembly its flacons, a mixing the ethanol; a shortfall never stops a sale, it
 * asks for a recount.
 */

/** The most one item may hold, in its unit. */
export const MAX_CONSUMABLE_COUNT = 100_000_000;
const NAME_MAX = 80;
export const CONSUMABLE_NOTE_MAX = 200;

const name = z.string().trim().min(1).max(NAME_MAX);
const count = z.number().int().min(0).max(MAX_CONSUMABLE_COUNT);

/** The link must fit the use: a flacon or box names its ml and is counted in pieces, the ethanol in ml. */
function checkLink(
  v: {
    unit: (typeof CONSUMABLE_UNITS)[number];
    use: (typeof CONSUMABLE_USES)[number];
    ml: number | null;
  },
  ctx: z.RefinementCtx,
) {
  const mls: readonly number[] = v.use === 'flacon' ? FLACON_MLS : v.use === 'box' ? BOX_MLS : [];
  if (mls.length > 0 && (v.ml === null || !mls.includes(v.ml)))
    ctx.addIssue({ code: 'custom', path: ['ml'], message: 'ml_for_use' });
  if (mls.length === 0 && v.ml !== null)
    ctx.addIssue({ code: 'custom', path: ['ml'], message: 'ml_for_use' });
  if (mls.length > 0 && v.unit !== 'pcs')
    ctx.addIssue({ code: 'custom', path: ['unit'], message: 'unit_for_use' });
  if (v.use === 'ethanol' && v.unit !== 'ml')
    ctx.addIssue({ code: 'custom', path: ['unit'], message: 'unit_for_use' });
}

/** A new item as staff add it. */
export const consumableInputSchema = z
  .object({
    nameRu: name,
    nameUz: name,
    unit: z.enum(CONSUMABLE_UNITS),
    use: z.enum(CONSUMABLE_USES),
    ml: z.number().int().nullable(),
    lowThreshold: count,
  })
  .superRefine(checkLink);
export type ConsumableInput = z.infer<typeof consumableInputSchema>;

/** An item's edit: its names, threshold and whether it is archived (its unit and link stay). */
export const consumableUpdateSchema = z.object({
  nameRu: name,
  nameUz: name,
  lowThreshold: count,
  archived: z.boolean(),
});
export type ConsumableUpdate = z.infer<typeof consumableUpdateSchema>;

/** Received: how many units came in. */
export const consumableReceiptBodySchema = z.object({
  quantity: z.number().int().min(1).max(MAX_CONSUMABLE_COUNT),
  note: z.string().trim().max(CONSUMABLE_NOTE_MAX).optional(),
});
export type ConsumableReceiptBody = z.infer<typeof consumableReceiptBodySchema>;

/** A count: compare-and-set against the count shown, with a reason. */
export const consumableCountBodySchema = z.object({
  onHand: count,
  /** The count the editor was looking at; when the stored one moved, 409 `changed` with it. */
  expected: z.number().int().min(0).optional(),
  reason: stockReasonSchema,
});
export type ConsumableCountBody = z.infer<typeof consumableCountBodySchema>;

export const consumableSchema = z.object({
  id: z.number().int(),
  nameRu: z.string(),
  nameUz: z.string(),
  unit: z.enum(CONSUMABLE_UNITS),
  use: z.enum(CONSUMABLE_USES),
  ml: z.number().int().nullable(),
  onHand: z.number().int(),
  lowThreshold: z.number().int(),
  /** Nothing left, at or under the threshold, or fine. */
  level: z.enum(STOCK_LEVELS),
  /** A use found fewer than it took («Пересчитайте»), until the next count. */
  needsRecount: z.boolean(),
  /** The count is ours (the seed's), not the owner's: none may reach launch. */
  isPlaceholder: z.boolean(),
  archived: z.boolean(),
});
export type Consumable = z.infer<typeof consumableSchema>;

export const consumablesListSchema = z.object({ items: z.array(consumableSchema) });
export type ConsumablesList = z.infer<typeof consumablesListSchema>;

export const consumableHistorySchema = z.object({
  item: consumableSchema,
  /** Newest first, at most `WAREHOUSE_HISTORY_LIMIT`. */
  moves: z.array(stockMoveSchema),
});
export type ConsumableHistory = z.infer<typeof consumableHistorySchema>;

export const consumablesErrorSchema = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'invalid',
    /** Another active item already has this use and ml. */
    'link_taken',
    /** A count compared against one that moved meanwhile: nothing written. */
    'changed',
    'try_again',
  ]),
  fields: z.array(z.string()).optional(),
  /** With `changed`: the count as it is now. */
  current: z.number().int().optional(),
});
export type ConsumablesError = z.infer<typeof consumablesErrorSchema>;

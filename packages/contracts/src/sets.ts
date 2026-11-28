import { z } from 'zod';
import {
  CART_MAX_QTY,
  DISCOVERY_VIAL_MLS,
  MAIN_SET_KEY,
  MAX_PRICE,
  SET_KEY,
  SET_SIZE,
} from './constants';
import { fragranceListItemSchema } from './catalog';
import { uzumUrlSchema } from './uzum';

/**
 * Sets (ADR 0009, 0042, 0044). Each Discovery set (its five vials 10 or 5 ml) is a product with
 * its own name, price, photo and stock, named by its key; the owner adds as many as he likes. A
 * builder set is any five different fragrances with 10 ml available, at the main set's price.
 * Money is integer so'm and comes from the server (ADR 0001).
 */

/** The ml of a Discovery set's vials (`DISCOVERY_VIAL_MLS`). */
export const discoveryVialMlSchema = z.union([
  z.literal(DISCOVERY_VIAL_MLS[0]),
  z.literal(DISCOVERY_VIAL_MLS[1]),
]);

/** Which Discovery set: its key (`SET_KEY`). */
export const setKeySchema = z.string().max(40).regex(SET_KEY);

/** `?key=discovery-5` names that set; without it, the main one. */
export const discoveryQuerySchema = z.object({
  key: setKeySchema.default(MAIN_SET_KEY),
});

/** A set's name in both languages: the owner's (ADR 0044). */
export const setNameSchema = z.object({ ru: z.string(), uz: z.string() });
export type SetName = z.infer<typeof setNameSchema>;
export const setFragranceSchema = z.object({
  /** Null for a fragrance hidden from the catalog: the box stays on sale, but it has no card to open. */
  slug: z.string().nullable(),
  name: z.string(),
  brand: z.string(),
  keyNotes: z.object({ ru: z.array(z.string()), uz: z.array(z.string()) }),
});
export type SetFragrance = z.infer<typeof setFragranceSchema>;

export const discoverySetSchema = z.object({
  key: setKeySchema,
  vialMl: discoveryVialMlSchema,
  name: setNameSchema,
  price: z.number().int().nonnegative(),
  /** The set's own on hand minus its reserve. 0 = sold out. */
  available: z.number().int().nonnegative(),
  soldOut: z.boolean(),
  /** Content hash of the owner's photo; null = the box photo shipped with the app. */
  photo: z.string().nullable(),
  /** The set's page on Uzum Market; null hides the button. */
  uzumUrl: z.string().nullable(),
  /** The five fragrances in the owner's order (fewer while the owner has not picked them). */
  fragrances: z.array(setFragranceSchema),
});
export type DiscoverySet = z.infer<typeof discoverySetSchema>;

/** The sets on sale, in the owner's order: the Mini App's «Наборы» lists them. */
export const discoverySetListSchema = z.array(discoverySetSchema);

export const builderSchema = z.object({
  price: z.number().int().nonnegative(),
  size: z.literal(SET_SIZE),
  /** Only fragrances with a 10 ml bottle available, in top-sellers order. */
  options: z.array(fragranceListItemSchema),
});
export type Builder = z.infer<typeof builderSchema>;

export const setsErrorSchema = z.object({ code: z.enum(['unauthorized', 'not_found']) });

export const addDiscoveryBodySchema = z.object({
  qty: z.number().int().min(1).max(CART_MAX_QTY).default(1),
  key: setKeySchema.default(MAIN_SET_KEY),
});

/** Exactly five different slugs: a wrong count or a repeat is refused before it reaches the DB. */
export const addBuilderBodySchema = z.object({
  slugs: z
    .array(z.string().min(1).max(100))
    .length(SET_SIZE)
    .refine((s) => new Set(s).size === s.length, 'duplicate'),
  qty: z.number().int().min(1).max(CART_MAX_QTY).default(1),
});

export const addSetErrorSchema = z.object({
  code: z.enum(['unauthorized', 'not_found', 'sold_out', 'unavailable', 'invalid']),
  /** For `unavailable`: the chosen fragrances whose 10 ml is not available any more. */
  slugs: z.array(z.string()).optional(),
});

/* ---- admin ---- */

export const adminDiscoverySetSchema = z.object({
  key: setKeySchema,
  vialMl: discoveryVialMlSchema,
  name: setNameSchema,
  /** Off sale and out of the shop (never the main set). */
  hidden: z.boolean(),
  price: z.number().int().nonnegative(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  /** On hand is under the reserve (ADR 0010): allowed, and shown as a warning. */
  belowReserve: z.boolean(),
  photo: z.string().nullable(),
  uzumUrl: z.string().nullable(),
  isPlaceholder: z.boolean(),
  /** Ordered; its length is below five until the owner completes it. `hidden`: the catalog hides it (the box still sells). */
  composition: z.array(z.object({ id: z.number().int(), name: z.string(), hidden: z.boolean() })),
});
export type AdminDiscoverySet = z.infer<typeof adminDiscoverySetSchema>;

const setNameText = z.string().trim().min(1).max(60);

/** The owner's edit of one Discovery set: its name, price (the main one's is the builder's too), whether it is on sale, and its five fragrances, in order. */
export const discoverySetInputSchema = z.object({
  name: z.object({ ru: setNameText, uz: setNameText }),
  /** Takes it off sale; refused on the main set. */
  hidden: z.boolean().default(false),
  price: z.number().int().min(0).max(MAX_PRICE),
  /** Omitted keeps the link as it is; empty clears it. */
  uzumUrl: uzumUrlSchema.optional(),
  composition: z
    .array(z.number().int().positive())
    .length(SET_SIZE)
    .refine((s) => new Set(s).size === s.length, 'duplicate'),
});
export type DiscoverySetInput = z.infer<typeof discoverySetInputSchema>;

/** A new Discovery set (ADR 0044): what an edit takes, plus the ml of its vials, fixed from then on. */
export const newDiscoverySetSchema = discoverySetInputSchema.extend({
  vialMl: discoveryVialMlSchema,
});
export type NewDiscoverySet = z.infer<typeof newDiscoverySetSchema>;

export const adminSetsErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'invalid', 'on_hand_changed']),
  fields: z.array(z.string()).optional(),
  /** With `on_hand_changed`: the count as it is now. */
  current: z.number().int().optional(),
});

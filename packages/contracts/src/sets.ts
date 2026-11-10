import { z } from 'zod';
import { CART_MAX_QTY, SET_SIZE } from './constants';
import { fragranceListItemSchema } from './catalog';

/**
 * Sets (ADR 0009). The Discovery set is a product with its own price, photo and stock; a builder
 * set is any five different fragrances with 10 ml available, at the same price. Money is integer
 * so'm and comes from the server (ADR 0001).
 */
export const setFragranceSchema = z.object({
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  keyNotes: z.object({ ru: z.array(z.string()), uz: z.array(z.string()) }),
});
export type SetFragrance = z.infer<typeof setFragranceSchema>;

export const discoverySetSchema = z.object({
  price: z.number().int().nonnegative(),
  /** The set's own on hand minus its reserve. 0 = sold out. */
  available: z.number().int().nonnegative(),
  soldOut: z.boolean(),
  /** Content hash of the owner's photo; null = the box photo shipped with the app. */
  photo: z.string().nullable(),
  /** The five fragrances in the owner's order (fewer while the owner has not picked them). */
  fragrances: z.array(setFragranceSchema),
});
export type DiscoverySet = z.infer<typeof discoverySetSchema>;

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
  price: z.number().int().nonnegative(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  photo: z.string().nullable(),
  isPlaceholder: z.boolean(),
  /** Ordered; its length is below five until the owner completes it. */
  composition: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
export type AdminDiscoverySet = z.infer<typeof adminDiscoverySetSchema>;

const MAX_PRICE = 100_000_000;
/** The owner's edit: the shared price of both sets and the five fragrances, in order. */
export const discoverySetInputSchema = z.object({
  price: z.number().int().min(0).max(MAX_PRICE),
  composition: z
    .array(z.number().int().positive())
    .length(SET_SIZE)
    .refine((s) => new Set(s).size === s.length, 'duplicate'),
});
export type DiscoverySetInput = z.infer<typeof discoverySetInputSchema>;

export const discoveryOnHandBodySchema = z.object({
  onHand: z.number().int().min(0).max(1_000_000),
});

export const adminSetsErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'invalid']),
  fields: z.array(z.string()).optional(),
});

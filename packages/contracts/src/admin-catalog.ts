import { z } from 'zod';
import { uzumUrlSchema } from './uzum';
import { stockReasonSchema } from './warehouse';
import {
  FRAGRANCE_TIERS,
  FRAGRANCE_TYPES,
  MAX_OIL_PRICE,
  MAX_PRICE,
  NOTE_LEVELS,
  SEASONS,
  SILLAGES,
  TIMES_OF_DAY,
} from './constants';

/**
 * Admin catalog editing (ticket #17). Text is trimmed; the API normalises Uzbek apostrophes on
 * save. RU and UZ of every pair are both required (ADR 0018). Money is integer so'm.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
/** Empty means "none": the API stores an empty string as null. */
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const mlSchema = z.union([z.literal(10), z.literal(30), z.literal(50)]);

export const VOLUME_MLS = [10, 30, 50] as const;
export const MAX_SIMILAR = 12;
/** The most boxes a Discovery set's count may hold. */
export const MAX_ON_HAND = 1_000_000;
/** The most ready concentrate a form or an import may count, ml. */
export const MAX_FORM_CONCENTRATE_ML = 100_000_000;
const concentrateMl = z
  .number()
  .min(0)
  .max(MAX_FORM_CONCENTRATE_ML)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'at most 3 decimals');
/** Key notes shown under the name: exactly this many, per language. */
export const KEY_NOTE_COUNT = 3;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const DEFAULT_LONGEVITY = { ru: 'до 24 часов', uz: '24 soatgacha' } as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date');
const som = z.number().int().min(0).max(MAX_PRICE);

/** What staff type for one volume. `saleEndsOn` is a Tashkent calendar day: it ends at 23:59:59. */
export const volumeInputSchema = z
  .object({
    ml: mlSchema,
    price: som,
    salePrice: som.nullable(),
    saleEndsOn: dateOnly.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.salePrice !== null && v.salePrice >= v.price) {
      ctx.addIssue({ code: 'custom', path: ['salePrice'], message: 'sale_below_price' });
    }
    if (v.saleEndsOn !== null && v.salePrice === null) {
      ctx.addIssue({ code: 'custom', path: ['saleEndsOn'], message: 'end_without_sale' });
    }
  });
export type VolumeInput = z.infer<typeof volumeInputSchema>;

const idList = z.array(z.number().int().positive()).max(20);

export const fragranceInputSchema = z
  .object({
    name: text(120),
    originalBrand: text(120),
    type: z.enum(FRAGRANCE_TYPES),
    familyId: z.number().int().positive().nullable(),
    season: z.enum(SEASONS),
    timeOfDay: z.enum(TIMES_OF_DAY),
    sillage: z.enum(SILLAGES),
    longevityRu: text(60),
    longevityUz: text(60),
    descriptionRu: text(2000),
    descriptionUz: text(2000),
    whenToWearRu: text(500),
    whenToWearUz: text(500),
    /** Exactly three, shown under the name and on list cards. */
    keyNotesRu: z.array(text(60)).length(KEY_NOTE_COUNT),
    keyNotesUz: z.array(text(60)).length(KEY_NOTE_COUNT),
    internalRemark: optionalText(1000),
    aliases: z.array(text(80)).max(20),
    uzumUrl: uzumUrlSchema.nullable(),
    /** The cost model (ADR 0040): so'm per gram on the oil invoice, before the supplier discount. */
    oilPrice: z.number().int().min(1).max(MAX_OIL_PRICE).nullable(),
    tier: z.enum(FRAGRANCE_TIERS).nullable(),
    oilSupplier: optionalText(120),
    oilInvoice: optionalText(120),
    isHit: z.boolean(),
    isNew: z.boolean(),
    hidden: z.boolean(),
    notes: z.object({ top: idList, heart: idList, base: idList }),
    /** Other fragrances, in the order they appear first in «Похожие ароматы». */
    similarIds: z.array(z.number().int().positive()).max(MAX_SIMILAR),
    volumes: z.array(volumeInputSchema).min(1).max(3),
    /**
     * The ready concentrate counted in the form, ml (ADR 0043). A new fragrance starts with it (none:
     * 0). On an existing one the server writes it only when it differs from `loadedConcentrateMl`,
     * and only if the stored count still equals that (a count made by a manager in between must
     * survive the owner saving the form). Omitted: not written.
     */
    concentrateMl: concentrateMl.optional(),
    loadedConcentrateMl: concentrateMl.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const mls = v.volumes.map((x) => x.ml);
    if (new Set(mls).size !== mls.length) {
      ctx.addIssue({ code: 'custom', path: ['volumes'], message: 'duplicate_volume' });
    }
    if (new Set(v.similarIds).size !== v.similarIds.length) {
      ctx.addIssue({ code: 'custom', path: ['similarIds'], message: 'duplicate_similar' });
    }
    // The same note may sit on two levels (the customer's guide does: lavender top and heart);
    // twice inside one level is a mistake.
    for (const l of NOTE_LEVELS) {
      if (new Set(v.notes[l]).size !== v.notes[l].length) {
        ctx.addIssue({ code: 'custom', path: ['notes', l], message: 'duplicate_note' });
      }
    }
  });
export type FragranceInput = z.infer<typeof fragranceInputSchema>;

export const volumeAdminSchema = z.object({
  id: z.number().int(),
  ml: mlSchema,
  price: z.number().int(),
  salePrice: z.number().int().nullable(),
  saleEndsOn: dateOnly.nullable(),
  /** Whole bottles the fragrance's free concentrate fills (ADR 0043). */
  available: z.number().int(),
  /** Content hash of the photo set, or null before the first upload. */
  photo: z.string().nullable(),
  isPlaceholder: z.boolean(),
});
export type VolumeAdmin = z.infer<typeof volumeAdminSchema>;

export const fragranceAdminSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  /** The internal product code: admin only. */
  code: z.string(),
  name: z.string(),
  originalBrand: z.string(),
  type: z.enum(FRAGRANCE_TYPES),
  familyId: z.number().int().nullable(),
  season: z.enum(SEASONS),
  timeOfDay: z.enum(TIMES_OF_DAY),
  sillage: z.enum(SILLAGES),
  longevityRu: z.string(),
  longevityUz: z.string(),
  descriptionRu: z.string(),
  descriptionUz: z.string(),
  whenToWearRu: z.string(),
  whenToWearUz: z.string(),
  keyNotesRu: z.array(z.string()),
  keyNotesUz: z.array(z.string()),
  internalRemark: z.string().nullable(),
  aliases: z.array(z.string()),
  uzumUrl: z.string().nullable(),
  oilPrice: z.number().int().nullable(),
  tier: z.enum(FRAGRANCE_TIERS).nullable(),
  oilSupplier: z.string().nullable(),
  oilInvoice: z.string().nullable(),
  isHit: z.boolean(),
  isNew: z.boolean(),
  hidden: z.boolean(),
  /** #83: the owner's number shown to customers; null = the setting `stock.shownDefault`. */
  shownCount: z.number().int().nullable(),
  /** The settings `stock.shownDefault` and `stock.shownMax`, for the editor beside `shownCount` (#83). */
  shownDefault: z.number().int(),
  shownMax: z.number().int(),
  notes: z.object({
    top: z.array(z.number().int()),
    heart: z.array(z.number().int()),
    base: z.array(z.number().int()),
  }),
  similarIds: z.array(z.number().int()),
  volumes: z.array(volumeAdminSchema),
  /** The ready concentrate (ADR 0043): counted, held by orders, below the reserve (allowed, flagged). */
  stock: z.object({
    concentrateMl: z.number(),
    reservedMl: z.number(),
    belowReserve: z.boolean(),
  }),
});
export type FragranceAdmin = z.infer<typeof fragranceAdminSchema>;

export const adminFragranceListItemSchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  code: z.string(),
  name: z.string(),
  originalBrand: z.string(),
  type: z.enum(FRAGRANCE_TYPES),
  familyRu: z.string().nullable(),
  familyUz: z.string().nullable(),
  isHit: z.boolean(),
  isNew: z.boolean(),
  hidden: z.boolean(),
  /** A photo of the smallest volume that has one, for the row thumbnail. */
  photo: z.string().nullable(),
  volumes: z.array(
    z.object({
      ml: z.number().int(),
      price: z.number().int(),
      salePrice: z.number().int().nullable(),
      /** Whole bottles the fragrance's free concentrate fills (ADR 0043). */
      available: z.number().int(),
      photo: z.string().nullable(),
    }),
  ),
  /** The ready concentrate, ml. */
  concentrateMl: z.number(),
});
export type AdminFragranceListItem = z.infer<typeof adminFragranceListItemSchema>;

export const fragranceListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(FRAGRANCE_TYPES).optional(),
  familyId: z.coerce.number().int().positive().optional(),
  visibility: z.enum(['visible', 'hidden']).optional(),
  flag: z.enum(['hit', 'new']).optional(),
});

export const hiddenBodySchema = z.object({ hidden: z.boolean() });
/** #83: 1 up to `stock.shownMax` (a setting, so the server checks the top); null clears it. */
export const shownCountBodySchema = z.object({ shownCount: z.number().int().min(1).nullable() });
/** A Discovery set's boxes counted (ADR 0009). */
export const onHandBodySchema = z.object({
  onHand: z.number().int().min(0).max(MAX_ON_HAND),
  /**
   * The on hand the editor was looking at. When it is sent and the stored count has moved, the
   * write is refused with 409 `on_hand_changed` and the current count (a concurrent edit).
   */
  expected: z.number().int().min(0).optional(),
  /** Why the count changed (a recount, breakage…): kept in the history and the audit (#76). */
  reason: stockReasonSchema,
});

/** Dictionary entries (families and notes): RU/UZ names and aliases. */
export const dictionaryInputSchema = z.object({
  nameRu: text(80),
  nameUz: text(80),
  aliases: z.array(text(80)).max(20),
});
/**
 * A note's name is written into comma-separated cells of the Excel file, so it may not contain a
 * comma (#26): a note «A, B» would read back as two notes.
 */
export const noteInputSchema = dictionaryInputSchema.superRefine((v, ctx) => {
  for (const path of ['nameRu', 'nameUz'] as const) {
    if (v[path].includes(',')) ctx.addIssue({ code: 'custom', path: [path], message: 'comma_in_note' });
  }
});
export type DictionaryInput = z.infer<typeof dictionaryInputSchema>;
export const dictionaryItemSchema = dictionaryInputSchema.extend({
  id: z.number().int(),
  /** How many fragrances use it. */
  uses: z.number().int(),
});
export type DictionaryItem = z.infer<typeof dictionaryItemSchema>;

export const photoResultSchema = z.object({ photo: z.string() });

/** Field-level validation failures come back as 422 with the offending paths. */
export const catalogAdminErrorSchema = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'conflict',
    'invalid',
    'on_hand_changed',
    /** The form's concentrate count moved meanwhile (ADR 0043): nothing written. */
    'concentrate_changed',
    /** A deadlock or serialization failure survived one retry: send the same request again. */
    'try_again',
  ]),
  /** Dotted field paths that failed a rule the schema cannot see (unknown ids, taken names). */
  fields: z.array(z.string()).optional(),
  /** With `on_hand_changed` from a single-count edit: the count as it is now. */
  current: z.number().int().optional(),
});

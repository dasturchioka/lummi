import { z } from 'zod';
import { INFO_PAGE_SLUGS, isStartTarget } from './constants';

/**
 * Content (ticket #21): the Home promo banner, the Home slogan and the info pages, RU/UZ.
 * Customer reads return RU/UZ pairs and the Mini App picks by language. The API normalises Uzbek
 * apostrophes on save. Page bodies are rich text (`@lummi/rich-text`), never HTML.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const SLOGAN_MAX = 80;
export const PAGE_BODY_MAX = 20_000;

export const contentErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'invalid']),
  fields: z.array(z.string()).optional(),
});

// ---- customer ----

export const promoBannerSchema = z.object({
  id: z.number().int(),
  /** Photo rendition set (`public/<hash>-<400|800|1200>.webp`); null until a photo is uploaded. */
  imageHash: z.string().nullable(),
  titleRu: z.string(),
  titleUz: z.string(),
  subtitleRu: z.string(),
  subtitleUz: z.string(),
  priceLineRu: z.string().nullable(),
  priceLineUz: z.string().nullable(),
  /** A `startapp` value; the Mini App maps it to a route. */
  target: z.string(),
});
export type PromoBanner = z.infer<typeof promoBannerSchema>;
export const sloganSchema = z.object({ ru: z.string(), uz: z.string() });
export type Slogan = z.infer<typeof sloganSchema>;
/** `null`: nothing saved yet, the app uses its own built-in slogan. */
export const sloganResponseSchema = z.object({ slogan: sloganSchema.nullable() });

/**
 * What Home needs from the owner, in one response so the slogan never swaps in after the first
 * paint: the active banner (null: Home shows the Discovery set banner) and the saved slogan.
 */
export const homeContentSchema = z.object({
  banner: promoBannerSchema.nullable(),
  slogan: sloganSchema.nullable(),
});
export type HomeContent = z.infer<typeof homeContentSchema>;

/**
 * `{name}` placeholders the API fills in a page body when a customer reads it, from the settings
 * (`pricing.freeDeliveryThreshold`, `delivery.defaultTariff`, `shop.managerUsername`), so the
 * text can't drift from the admin. Money reads `100 000 сум` / `100 000 soʻm` per language;
 * `managerLink` is the manager's t.me link. The admin editor lists them.
 */
export const CONTENT_PLACEHOLDERS = [
  'freeDeliveryThreshold',
  'defaultTariff',
  'managerUsername',
  'managerLink',
] as const;

const slugSchema = z.enum(INFO_PAGE_SLUGS);

export const infoPageListItemSchema = z.object({
  slug: slugSchema,
  titleRu: z.string(),
  titleUz: z.string(),
  /** Pending the customer's approval. Customers still read it; the app never shows this flag. */
  draft: z.boolean(),
});
export type InfoPageListItem = z.infer<typeof infoPageListItemSchema>;
export const infoPageSchema = infoPageListItemSchema.extend({
  bodyRu: z.string(),
  bodyUz: z.string(),
});
export type InfoPage = z.infer<typeof infoPageSchema>;
export const infoPageSlugParamsSchema = z.object({ slug: z.string().max(40) });
export const infoPageErrorSchema = z.object({ code: z.literal('not_found') });

// ---- admin ----

export const bannerInputSchema = z.object({
  titleRu: text(60),
  titleUz: text(60),
  subtitleRu: text(160),
  subtitleUz: text(160),
  priceLineRu: optionalText(40),
  priceLineUz: optionalText(40),
  target: z
    .string()
    .trim()
    .max(64)
    .refine((v) => isStartTarget(v), 'start_target'),
});
export type BannerInput = z.infer<typeof bannerInputSchema>;

export const adminBannerSchema = promoBannerSchema.extend({
  active: z.boolean(),
  updatedAt: z.string(),
});
export type AdminBanner = z.infer<typeof adminBannerSchema>;
export const bannerActiveBodySchema = z.object({ active: z.boolean() });

export const sloganInputSchema = z.object({ ru: text(SLOGAN_MAX), uz: text(SLOGAN_MAX) });

export const adminInfoPageSchema = infoPageSchema.extend({ updatedAt: z.string() });
export type AdminInfoPage = z.infer<typeof adminInfoPageSchema>;
export const infoPageInputSchema = z.object({
  titleRu: text(80),
  titleUz: text(80),
  bodyRu: z.string().trim().max(PAGE_BODY_MAX),
  bodyUz: z.string().trim().max(PAGE_BODY_MAX),
  draft: z.boolean(),
});
export type InfoPageInput = z.infer<typeof infoPageInputSchema>;

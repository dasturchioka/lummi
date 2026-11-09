import { z } from 'zod';

const som = z.number().int().min(0).max(100_000_000);

/** A delivery region with its tariff (spec §8, Changes 2026-11-06). */
export const regionSchema = z.object({
  id: z.number().int(),
  nameRu: z.string(),
  nameUz: z.string(),
  deliveryTariff: som,
});
export type RegionDto = z.infer<typeof regionSchema>;

export const citySchema = z.object({ city: z.string(), pointCount: z.number().int() });
export type CityDto = z.infer<typeof citySchema>;

/** A BTS pickup point as a customer sees it. Hidden points never appear. */
export const btsPointSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  regionId: z.number().int(),
  city: z.string(),
  name: z.string(),
  address: z.string(),
  landmark: z.string().nullable(),
  hours: z.string().nullable(),
});
export type BtsPointDto = z.infer<typeof btsPointSchema>;

export const POINT_SEARCH_MIN = 2;
export const POINT_SEARCH_LIMIT = 50;

/** Either a city of a region, or a text search across every region; at least one is required. */
export const pointsQuerySchema = z
  .object({
    regionId: z.coerce.number().int().positive().optional(),
    city: z.string().trim().min(1).max(200).optional(),
    q: z.string().trim().min(POINT_SEARCH_MIN).max(100).optional(),
  })
  .refine((v) => (v.city !== undefined && v.regionId !== undefined) || v.q !== undefined, {
    message: 'give regionId with city, or q',
  });

export const deliveryErrorSchema = z.object({
  code: z.enum(['unauthorized', 'not_found', 'unknown_city']),
});

/** The customer's delivery city on Home, with the region's tariff. It is a place, never a price input. */
export const deliveryCitySchema = z.object({
  region: regionSchema,
  city: z.string(),
});
export type DeliveryCityDto = z.infer<typeof deliveryCitySchema>;
export const deliveryCityResponseSchema = z.object({ deliveryCity: deliveryCitySchema.nullable() });

export const setDeliveryCityBodySchema = z.object({
  regionId: z.number().int().positive(),
  city: z.string().trim().min(1).max(200),
});

/* ---- admin ---- */

export const adminRegionSchema = regionSchema.extend({
  code: z.string(),
  pointCount: z.number().int(),
  activePointCount: z.number().int(),
});
export type AdminRegionDto = z.infer<typeof adminRegionSchema>;

export const setTariffBodySchema = z.object({ deliveryTariff: som });

export const adminBtsPointSchema = btsPointSchema.extend({
  active: z.boolean(),
  regionNameRu: z.string(),
  regionNameUz: z.string(),
});
export type AdminBtsPointDto = z.infer<typeof adminBtsPointSchema>;

const pointText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const ADMIN_POINTS_PAGE_SIZE = 50;

export const adminPointsQuerySchema = z.object({
  regionId: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'active', 'hidden']).default('all'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type AdminPointsQuery = z.input<typeof adminPointsQuerySchema>;

export const adminPointsPageSchema = z.object({
  items: z.array(adminBtsPointSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const createBtsPointBodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\p{L}\p{N}._-]+$/u, 'letters, digits . _ -'),
  regionId: z.number().int().positive(),
  city: pointText(200),
  name: pointText(200),
  address: pointText(500),
  landmark: optionalText(500),
  hours: optionalText(300),
  active: z.boolean().default(true),
});
export type CreateBtsPointBody = z.input<typeof createBtsPointBodySchema>;

/** The code is the point's identity and cannot change; everything else can. */
export const updateBtsPointBodySchema = createBtsPointBodySchema
  .omit({ code: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export type UpdateBtsPointBody = z.input<typeof updateBtsPointBodySchema>;

export const adminDeliveryErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'conflict', 'unknown_region']),
});

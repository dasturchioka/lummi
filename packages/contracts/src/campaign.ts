import { z } from 'zod';
import { CAMPAIGN_CODE_PATTERN, CAMPAIGN_SOURCES, isStartTarget } from './constants';
import { promoCodeTextSchema } from './promo';

/**
 * Campaign links (ticket #35, ADR 0022): the owner makes one per channel, with a target screen, an
 * optional promo code it prefills and a source. A shopper opening `?startapp=l_<code>` lands on the
 * target; the open is logged, and orders and customers take their source from it.
 */
export { CAMPAIGN_SOURCES, type CampaignSource } from './constants';

export const SOURCE_LABEL_MAX = 60;

/**
 * What the owner saves. `code` is left out on create to get a generated one; it can be edited
 * while no one has opened the link (the QR on a printed stand would otherwise stop working).
 */
export const campaignLinkInputSchema = z
  .object({
    code: z.string().regex(CAMPAIGN_CODE_PATTERN, 'code_format').optional(),
    /** A `START_TARGETS` value or `p_<slug>`: one list with banners and broadcasts. */
    target: z.string().trim().max(64).refine(isStartTarget, 'start_target'),
    /** An existing promo code, or none; stored by its row, shown as its text. */
    promoCode: promoCodeTextSchema.nullable(),
    source: z.enum(CAMPAIGN_SOURCES),
    /** «Блогер Иван», «Стойка в ТЦ Samarqand Darvoza»: required for the open-ended sources. */
    sourceLabel: z.string().trim().max(SOURCE_LABEL_MAX).nullable(),
  })
  .superRefine((v, ctx) => {
    if ((v.source === 'other' || v.source === 'blogger') && !v.sourceLabel)
      ctx.addIssue({ code: 'custom', path: ['sourceLabel'], message: 'required' });
  });
export type CampaignLinkInput = z.infer<typeof campaignLinkInputSchema>;

export const adminCampaignLinkSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  target: z.string(),
  promoCode: z.string().nullable(),
  source: z.enum(CAMPAIGN_SOURCES),
  sourceLabel: z.string().nullable(),
  /** `https://t.me/<bot>?startapp=l_<code>`: what the QR encodes. */
  url: z.string(),
  /** Unique customers who opened it (ADR 0022: "opens" in reports count customers). */
  opens: z.number().int().nonnegative(),
  /** Orders that took this link as their source. */
  orders: z.number().int().nonnegative(),
  /** Whether anyone ever opened it: the code is then fixed and the link cannot be deleted. */
  everOpened: z.boolean(),
  createdAt: z.string(),
});
export type AdminCampaignLink = z.infer<typeof adminCampaignLinkSchema>;

export const campaignErrorSchema = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'invalid',
    'code_taken',
    'unknown_promo_code',
    'code_locked',
    'in_use',
  ]),
  fields: z.array(z.string()).optional(),
});

export const QR_FORMATS = ['png', 'svg'] as const;
export const campaignQrQuerySchema = z.object({ format: z.enum(QR_FORMATS).default('png') });

// ---- the Mini App ----

/** The Mini App reports an `l_<code>` launch once, after sign-in. */
export const openCampaignBodySchema = z.object({ code: z.string().regex(CAMPAIGN_CODE_PATTERN) });
export const openCampaignResultSchema = z.object({
  /** A start target (`p_<slug>`, `builder`, ...): the Mini App routes it with its one route table. */
  target: z.string(),
  /** The link's promo code was put in the cart; the cart's quote says whether it applies. */
  promoCodePrefilled: z.boolean(),
});
export type OpenCampaignResult = z.infer<typeof openCampaignResultSchema>;
export const campaignOpenErrorSchema = z.object({ code: z.enum(['unauthorized', 'not_found']) });

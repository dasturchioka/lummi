import { z } from 'zod';

/** Telegram's limits for one message: a caption (with an image) and plain text. */
export const CAPTION_MAX = 1024;
export const TEXT_MAX = 4096;

/** The Mini App's fixed `startapp` targets (apps/miniapp/src/lib/startapp.ts keeps the routes; a test keeps both lists in step). */
export const STARTAPP_TARGETS = ['home', 'catalog', 'cart', 'orders', 'profile'] as const;
/** `p_<slug>` opens a fragrance card; the slug is ASCII kebab case (ADR 0016). */
const FRAGRANCE_TARGET = /^p_[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isStartappTarget = (v: string) =>
  (STARTAPP_TARGETS as readonly string[]).includes(v) || FRAGRANCE_TARGET.test(v);

export const BROADCAST_AUDIENCES = ['all', 'ru', 'uz'] as const;
export const broadcastAudienceSchema = z.enum(BROADCAST_AUDIENCES);
export type BroadcastAudience = z.infer<typeof broadcastAudienceSchema>;

/** Where an uploaded broadcast image lives in the FileStore: a content hash and the real type's extension. */
export const BROADCAST_IMAGE_KEY = /^broadcasts\/[a-f0-9]{16}\.(jpg|png|webp)$/;

/** What the owner writes; the server checks it again (the limit depends on whether an image rides along). */
export const broadcastBodySchema = z
  .object({
    textRu: z.string().trim().min(1, 'required').max(TEXT_MAX, 'too_long'),
    textUz: z.string().trim().min(1, 'required').max(TEXT_MAX, 'too_long'),
    imageKey: z.string().regex(BROADCAST_IMAGE_KEY).nullable(),
    buttonTarget: z.string().refine(isStartappTarget, 'target').nullable(),
    audience: broadcastAudienceSchema,
  })
  .superRefine((v, ctx) => {
    if (!v.imageKey) return;
    for (const field of ['textRu', 'textUz'] as const) {
      if (v[field].length > CAPTION_MAX) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'caption_too_long' });
      }
    }
  });
export type BroadcastBody = z.infer<typeof broadcastBodySchema>;

export const broadcastCountsSchema = z.object({
  total: z.number().int(),
  sent: z.number().int(),
  blocked: z.number().int(),
  failed: z.number().int(),
  pending: z.number().int(),
});
export type BroadcastCounts = z.infer<typeof broadcastCountsSchema>;

export const broadcastSchema = z.object({
  id: z.number().int(),
  createdAt: z.string(),
  createdByName: z.string(),
  audience: broadcastAudienceSchema,
  textRu: z.string(),
  textUz: z.string(),
  hasImage: z.boolean(),
  buttonTarget: z.string().nullable(),
  /** Still sending while any delivery is pending. */
  status: z.enum(['sending', 'done']),
  counts: broadcastCountsSchema,
});
export type BroadcastDto = z.infer<typeof broadcastSchema>;

export const audienceQuerySchema = z.object({ audience: broadcastAudienceSchema });
export const audienceCountSchema = z.object({
  /** Everyone in the audience. */
  total: z.number().int(),
  /** Those the bot may write to; the rest (refused or blocked) are counted «blocked» at once. */
  reachable: z.number().int(),
});

export const testSendResultSchema = z.object({ sent: z.array(z.enum(['ru', 'uz'])) });

export const broadcastErrorSchema = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'invalid',
    'test_blocked',
    'test_failed',
  ]),
  fields: z.array(z.string()).optional(),
});

/** Words the brand rules ban (CLAUDE.md "Brand and copy rules"). The composer warns; it never blocks. */
const BANNED = /копи[яюией]|реплик|оригинал|oil perfume|масляные духи|nusxa|replika|original/iu;
const EMOJI = /\p{Extended_Pictographic}/gu;
export const MAX_EMOJI = 2;

export type CopyWarning = 'banned' | 'emoji';
/** Soft copy-rule checks for one text: banned words and more than two emoji. */
export function copyWarnings(text: string): CopyWarning[] {
  const out: CopyWarning[] = [];
  if (BANNED.test(text)) out.push('banned');
  if ((text.match(EMOJI) ?? []).length > MAX_EMOJI) out.push('emoji');
  return out;
}

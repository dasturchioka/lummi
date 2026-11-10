import { z } from 'zod';
import { isStartTarget } from './constants';

/** Telegram's limits for one message: a caption (with an image) and plain text. */
export const CAPTION_MAX = 1024;
export const TEXT_MAX = 4096;

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
    // the one `startapp` target list (`@lummi/contracts/constants`), shared with the promo banner
    buttonTarget: z.string().refine(isStartTarget, 'target').nullable(),
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
  /** The fragrance's name behind a `p_<slug>` target, for the label. */
  buttonFragrance: z.string().nullable(),
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
  /** The reachable ones by the language they will get it in (one is 0 for a one-language audience). */
  reachableByLanguage: z.object({ ru: z.number().int(), uz: z.number().int() }),
});
export type AudienceCount = z.infer<typeof audienceCountSchema>;

/** A `p_<slug>` button target as the owner types it: the fragrance's name, if there is one. */
export const fragranceTargetQuerySchema = z.object({
  slug: z.string().trim().min(1).max(200),
});
export const fragranceTargetSchema = z.object({ name: z.string() });

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

/**
 * Soft copy-rule checks (CLAUDE.md "Brand and copy rules"): banned words, fragrance numbers,
 * concentration percentages, more than two emoji. The required disclaimer «не оригинальный
 * парфюм» is allowed, so it is taken out before the banned words are looked for. The composer
 * warns; it never blocks.
 */
const DISCLAIMER = /не\s+оригинальн\p{L}*\s+парфюм|asl\s+atir\s+emas|original\s+atir\s+emas/giu;
const BANNED = /копи[яюией]|реплик|оригинал|oil perfume|масляные духи|nusxa|replika|original/iu;
const NUMBER = /\bNo\.?\s?\d+|№\s?\d+/iu;
/** A percentage as written («20%», «20 %»), so the warning can name it. */
const CONCENTRATION_WORD = /\d+(?:[.,]\d+)?\s?%/u;
const EMOJI = /\p{Extended_Pictographic}/gu;
export const MAX_EMOJI = 2;

export type CopyWarningKind = 'banned' | 'numbers' | 'emoji';
/** One rule the text breaks, with what broke it as written («Копия», «No.123», «20%», «🎉»). */
export type CopyWarning = { kind: CopyWarningKind; matches: string[] };

/** Every match of `re` in `text`, widened to its whole word, first spelling of each kept. */
function found(text: string, re: RegExp, word: boolean): string[] {
  const out = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) {
    let start = m.index;
    let end = start + m[0].length;
    if (word) {
      while (start > 0 && /[\p{L}\p{M}]/u.test(text[start - 1] as string)) start--;
      while (end < text.length && /[\p{L}\p{M}]/u.test(text[end] as string)) end++;
    }
    const hit = text.slice(start, end).trim();
    if (hit && !out.has(hit.toLowerCase())) out.set(hit.toLowerCase(), hit);
  }
  return [...out.values()];
}

export function copyWarnings(text: string): CopyWarning[] {
  const out: CopyWarning[] = [];
  const body = text.replace(DISCLAIMER, ' ');
  const banned = found(body, BANNED, true);
  if (banned.length) out.push({ kind: 'banned', matches: banned });
  const numbers = [...found(body, NUMBER, false), ...found(body, CONCENTRATION_WORD, false)];
  if (numbers.length) out.push({ kind: 'numbers', matches: numbers });
  const emoji = body.match(EMOJI) ?? [];
  if (emoji.length > MAX_EMOJI) out.push({ kind: 'emoji', matches: [...new Set(emoji)] });
  return out;
}

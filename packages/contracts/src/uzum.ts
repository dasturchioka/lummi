import { z } from 'zod';

/**
 * The one rule for a Uzum Market link (a fragrance's, the Discovery set's, the Excel import's, the
 * admin forms'): trimmed, https only, empty = no link. Callers that allow «none» as null wrap it
 * in `.nullable()`; an empty string clears the link.
 */
export const uzumUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\/\S+$/i.test(v), 'url');

/** For forms: does this text pass `uzumUrlSchema`? */
export const isUzumUrl = (v: string): boolean => uzumUrlSchema.safeParse(v).success;

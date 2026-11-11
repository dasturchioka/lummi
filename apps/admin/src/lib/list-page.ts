import { redirect } from 'next/navigation';
import type { ZodTypeAny } from 'zod';

/** A page's `searchParams` as Next gives them. */
export type Search = Record<string, string | string[] | undefined>;
export type Filters<K extends string> = Partial<Record<K, string>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * The list filters a URL holds, as the API contract takes them: each key's first value, trimmed
 * (`clean` may normalise it further), kept only when the key's schema accepts it, so a hand-edited
 * link never reaches the API as a 400.
 */
export function readFilters<K extends string>(
  sp: Search,
  shape: Record<K, ZodTypeAny>,
  keys: readonly K[],
  clean: Partial<Record<K, (v: string) => string>> = {},
): Filters<K> {
  const out: Filters<K> = {};
  for (const key of keys) {
    const raw = one(sp[key])?.trim();
    const value = raw && clean[key] ? clean[key](raw) : raw;
    if (value && shape[key].safeParse(value).success) out[key] = value;
  }
  return out;
}

/** The page the URL asks for, 1 when it asks for none or nonsense. */
export const readPage = (sp: Search) => Math.max(1, Number.parseInt(one(sp.page) ?? '1', 10) || 1);

/** The list's URL with its filters, at page `p` (page 1 leaves it out). */
export function listHref(base: string, filters: Record<string, string | undefined>, p = 1) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
  if (p > 1) q.set('page', String(p));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** A page past the end (an old link, fewer rows after a filter) opens the last one. */
export function clampPage(
  base: string,
  filters: Record<string, string | undefined>,
  page: number,
  total: number,
  pageSize: number,
) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (page > last) redirect(listHref(base, filters, last));
}

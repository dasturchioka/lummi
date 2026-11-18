import type { Search } from './list-page';

const KG = /^\d+(?:[.,]\d+)?$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();
const kgOf = (raw: string | undefined, max: number): number | undefined => {
  if (!raw || !KG.test(raw)) return undefined;
  const n = Number(raw.replace(',', '.'));
  return n <= max ? n : undefined;
};

/**
 * The planner's what-if inputs from the URL: `kg` is the default kilograms of oil for every
 * fragrance, `k<id>` a single fragrance's own. Anything that is not a plain number up to the
 * contract's limit is dropped, so a hand-edited link never reaches the API as a 400.
 */
export function readPlanQuery(sp: Search): { kg?: number; by?: string } {
  const kg = kgOf(one(sp.kg), 1000);
  const own = Object.entries(sp).flatMap(([key, value]) => {
    const id = /^k(\d{1,15})$/.exec(key)?.[1];
    const n = id ? kgOf(one(value), 1000) : undefined;
    return id && n !== undefined ? [`${id}:${n}`] : [];
  });
  return { ...(kg === undefined ? {} : { kg }), ...(own.length ? { by: own.join(',') } : {}) };
}

/** The same inputs as a query string, for the Excel link. */
export function planQueryString(q: { kg?: number; by?: string }, lang: string): string {
  const p = new URLSearchParams({ lang });
  if (q.kg !== undefined) p.set('kg', String(q.kg));
  if (q.by) p.set('by', q.by);
  return p.toString();
}

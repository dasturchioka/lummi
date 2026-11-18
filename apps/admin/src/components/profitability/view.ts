import type { SalesChannel } from '@lummi/contracts';

/*
 * The «Рентабельность» page's view lives in its URL (#77), so a reload, a link from a table row to
 * the calculator and the Excel export all see what the owner chose. Defaults stay out of the URL.
 */

export const TABS = ['table', 'calculator', 'order'] as const;
export type Tab = (typeof TABS)[number];
export const VOLUME_FILTERS = ['all', '10', '30', '50', 'set'] as const;
export type VolumeFilter = (typeof VOLUME_FILTERS)[number];
export const SORT_KEYS = ['name', 'price', 'cost', 'orderCosts', 'profit', 'margin'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface View {
  tab: Tab;
  channel: SalesChannel;
  afterSetDiscount: boolean;
  giftSample: boolean;
  /** The table's volume filter. */
  ml: VolumeFilter;
  sort: SortKey;
  dir: 'asc' | 'desc';
  /** The calculator's sale: a fragrance's volume, or the Discovery set. */
  fragrance: number | null;
  calcMl: number | null;
  set: boolean;
  /** The order simulator's lines. */
  lines: SimLine[];
}

/** One simulator line: a fragrance's volume or the Discovery set, and how many. */
export type SimLine = { item: { fragrance: number; ml: number } | 'set'; qty: number };

/** The simulator's most lines (the API takes 30). */
export const MAX_LINES = 30;
/** The simulator's most units on a line (the API takes 99). */
export const MAX_QTY = 99;

export const DEFAULT_VIEW: View = {
  tab: 'table',
  channel: 'miniapp',
  afterSetDiscount: false,
  giftSample: false,
  ml: 'all',
  // the calculator's own default: the most profitable first
  sort: 'profit',
  dir: 'desc',
  fragrance: null,
  calcMl: null,
  set: false,
  lines: [],
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;
const positive = (v: string | undefined) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export function readView(sp: Search): View {
  return {
    tab: pick(TABS, one(sp.tab), DEFAULT_VIEW.tab),
    channel: one(sp.channel) === 'uzum' ? 'uzum' : 'miniapp',
    afterSetDiscount: one(sp.afterSetDiscount) === '1',
    giftSample: one(sp.giftSample) === '1',
    ml: pick(VOLUME_FILTERS, one(sp.ml), DEFAULT_VIEW.ml),
    sort: pick(SORT_KEYS, one(sp.sort), DEFAULT_VIEW.sort),
    dir: one(sp.dir) === 'asc' ? 'asc' : one(sp.dir) === 'desc' ? 'desc' : DEFAULT_VIEW.dir,
    fragrance: positive(one(sp.fragrance)),
    calcMl: positive(one(sp.calcMl)),
    set: one(sp.set) === '1',
    lines: readLines(one(sp.lines)),
  };
}

/** `12:30:1,set:2`: fragrance id, ml and quantity, or the set and its quantity. */
function readLines(v: string | undefined): SimLine[] {
  if (!v) return [];
  const out: SimLine[] = [];
  for (const part of v.split(',').slice(0, MAX_LINES)) {
    const bits = part.split(':');
    const qty = Math.min(positive(bits.at(-1)) ?? 1, MAX_QTY);
    if (bits[0] === 'set' && bits.length === 2) out.push({ item: 'set', qty });
    else if (bits.length === 3) {
      const fragrance = positive(bits[0]);
      const ml = positive(bits[1]);
      if (fragrance && ml) out.push({ item: { fragrance, ml }, qty });
    }
  }
  return out;
}

export function writeLines(lines: readonly SimLine[]): string {
  return lines
    .map((l) => (l.item === 'set' ? `set:${l.qty}` : `${l.item.fragrance}:${l.item.ml}:${l.qty}`))
    .join(',');
}

/** The page's URL for `view` changed by `change`; each default is left out. */
export function hrefOf(view: View, change: Partial<View> = {}): string {
  const v = { ...view, ...change };
  const q = new URLSearchParams();
  if (v.tab !== DEFAULT_VIEW.tab) q.set('tab', v.tab);
  if (v.channel !== DEFAULT_VIEW.channel) q.set('channel', v.channel);
  if (v.afterSetDiscount) q.set('afterSetDiscount', '1');
  if (v.giftSample) q.set('giftSample', '1');
  if (v.tab === 'table') {
    if (v.ml !== DEFAULT_VIEW.ml) q.set('ml', v.ml);
    if (v.sort !== DEFAULT_VIEW.sort || v.dir !== DEFAULT_VIEW.dir) {
      q.set('sort', v.sort);
      q.set('dir', v.dir);
    }
  }
  if (v.tab === 'calculator') {
    if (v.set) q.set('set', '1');
    else if (v.fragrance !== null) {
      q.set('fragrance', String(v.fragrance));
      if (v.calcMl !== null) q.set('calcMl', String(v.calcMl));
    }
  }
  if (v.tab === 'order' && v.lines.length) q.set('lines', writeLines(v.lines));
  const query = q.toString();
  return query ? `/profitability?${query}` : '/profitability';
}

/** The API's query for the table and its export. */
export function tableQuery(view: View) {
  return {
    channel: view.channel,
    afterSetDiscount: view.afterSetDiscount ? ('1' as const) : ('0' as const),
    giftSample: view.giftSample ? ('1' as const) : ('0' as const),
  };
}

/** A fragrance the calculator and the simulator offer, with the volumes it is sold in. */
export interface FragranceOption {
  id: number;
  name: string;
  brand: string | null;
  mls: number[];
}

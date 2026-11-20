import type { CartDto } from '@lummi/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * `CART_KEY` of `./queries`, spelled out: importing that module here splits it into a chunk of its
 * own at launch (+0.2 KB). The tests write the cart under `CART_KEY`, so a drift fails them.
 */
const CART_KEY = ['cart'] as const;

/** The discount that stopped applying: the server names an entitlement, a refused tap what was tapped. */
export type LapsedDiscount =
  NonNullable<CartDto['lapsedDiscount']> | { type: 'promo_code'; code: string };

/** The cart's notice that the shopper's discount lapsed (#39); `what` is null when it is not named. */
export interface Lapsed {
  what: LapsedDiscount | null;
}

/** What the server reported about the shopper's chosen discount (#39): null while all is well. */
export interface StaleChoiceNote {
  get(): Lapsed | null;
  subscribe(listener: () => void): () => void;
  /** A tap the server refused (409, taken meanwhile): said the same way as a lapsed choice. */
  report(what: LapsedDiscount | null): void;
  /** The shopper picked a discount (a row, «Переключить», a typed code). */
  clear(): void;
}

const notes = new WeakMap<QueryClient, StaleChoiceNote>();

/**
 * The server reports a stale chosen discount once (spec Changes 2026-11-11, #39 (6)), in whichever
 * cart answer comes first: the tab bar's read on launch, an add from a fragrance card, the cart
 * screen's own. Every one of them lands in the one cart query, so this watches that query and keeps
 * the report until the shopper picks a discount or the cart empties (its choice went with its
 * lines). The app's client is watched from launch (`app/queryClient`), so nothing is missed before
 * the lazy cart screen loads.
 */
export function watchStaleChoice(qc: QueryClient): StaleChoiceNote {
  const known = notes.get(qc);
  if (known) return known;
  let stale: Lapsed | null = null;
  const listeners = new Set<() => void>();
  const set = (v: Lapsed | null) => {
    if (stale === v) return;
    stale = v;
    for (const l of listeners) l();
  };
  qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success') return;
    const key = e.query.queryKey;
    if (key.length !== CART_KEY.length || key[0] !== CART_KEY[0]) return;
    const cart = e.query.state.data as CartDto | undefined;
    if (!cart) return;
    if (cart.lines.length === 0) set(null);
    else if (cart.quote.staleChoice) set({ what: cart.lapsedDiscount });
  });
  const note: StaleChoiceNote = {
    get: () => stale,
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    report: (what) => set({ what }),
    clear: () => set(null),
  };
  notes.set(qc, note);
  return note;
}

/** The cart screen's view of the note, for the app's query client. */
export function useStaleChoice(): Pick<StaleChoiceNote, 'report' | 'clear'> & {
  lapsed: Lapsed | null;
} {
  const note = watchStaleChoice(useQueryClient());
  const lapsed = useSyncExternalStore(note.subscribe, note.get);
  return { lapsed, report: note.report, clear: note.clear };
}

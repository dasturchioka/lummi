import type { CartDto } from '@lummi/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * `CART_KEY` of `./queries`, spelled out: importing that module here splits it into a chunk of its
 * own at launch (+0.2 KB). The tests write the cart under `CART_KEY`, so a drift fails them.
 */
const CART_KEY = ['cart'] as const;

/** Whether the server reported the shopper's chosen discount as stale (#39). */
export interface StaleChoiceNote {
  get(): boolean;
  subscribe(listener: () => void): () => void;
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
  let stale = false;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
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
    if (cart.lines.length === 0) set(false);
    else if (cart.quote.staleChoice) set(true);
  });
  const note: StaleChoiceNote = {
    get: () => stale,
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    clear: () => set(false),
  };
  notes.set(qc, note);
  return note;
}

/** The cart screen's view of the note, for the app's query client. */
export function useStaleChoice(): { stale: boolean; clear: () => void } {
  const note = watchStaleChoice(useQueryClient());
  const stale = useSyncExternalStore(note.subscribe, note.get);
  return { stale, clear: note.clear };
}

import { lazy, Suspense, useSyncExternalStore } from 'react';

/*
 * The note a list «+» leaves («Добавлено в корзину», «Осталось 3», «Не больше 99 шт.»): the «+»
 * calls `showShopNote`, and the shell's `ShopNoteHost` shows it. The pill itself (`ShopNote`)
 * comes with the «+», so Home's first screen does not carry it.
 */
export type ShopNoteState = { text: string };
let current: ShopNoteState | null = null;
const listeners = new Set<() => void>();
export const subscribeShopNote = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const shopNote = () => current;

export function showShopNote(text: string): void {
  current = { text }; // a new object each time: the same words again still show again
  for (const l of listeners) l();
}

// Through the «+» that called it, already loaded by then: a chunk of its own would split the
// shared vendor chunk the first screen loads (rolldown groups modules by who reaches them).
const ShopNote = lazy(async () => ({ default: (await import('./AddButton')).ShopNote }));

/** In the shell: nothing until the first note, then the pill above the tab bar or the bottom edge. */
export function ShopNoteHost({ tabBar }: { tabBar: boolean }) {
  const any = useSyncExternalStore(subscribeShopNote, () => current !== null);
  return any ? (
    <Suspense fallback={null}>
      <ShopNote tabBar={tabBar} />
    </Suspense>
  ) : null;
}

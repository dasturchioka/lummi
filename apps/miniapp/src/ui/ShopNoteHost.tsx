import { lazy, Suspense, useSyncExternalStore } from 'react';

/*
 * The note a list «+» leaves («Добавлено в корзину», «Осталось 3», «Не больше 99 шт.»): the «+»
 * calls `showShopNote`, and the shell's `ShopNoteHost` shows it. The pill itself (`ShopNote`)
 * comes with the «+» (`armShopNote`), so Home's first screen does not carry it.
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

let armed = false;
/**
 * A «+» is on screen: mount the pill, still empty, before any press. The first note then shows at
 * once (no lazy load and Suspense reveal in between), and its status region already exists when
 * it speaks, so a screen reader announces it.
 */
export function armShopNote(): void {
  if (armed) return;
  armed = true;
  for (const l of listeners) l();
}

// Through the «+» that called it, already loaded by then: a chunk of its own would split the
// shared vendor chunk the first screen loads (rolldown groups modules by who reaches them).
const ShopNote = lazy(async () => ({ default: (await import('./AddButton')).ShopNote }));

/**
 * In the shell: nothing until a «+» shows up, then the pill above the tab bar or the bottom edge,
 * for the screen on show (`screen`, its path).
 */
export function ShopNoteHost({ tabBar, screen }: { tabBar: boolean; screen: string }) {
  const any = useSyncExternalStore(subscribeShopNote, () => armed || current !== null);
  return any ? (
    <Suspense fallback={null}>
      <ShopNote tabBar={tabBar} screen={screen} />
    </Suspense>
  ) : null;
}

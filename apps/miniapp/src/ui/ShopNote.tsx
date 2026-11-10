import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The note a list «+» leaves («Добавлено в корзину», «Осталось 3», «Не больше 99 шт.»): the
 * card dock's `DockNote`, for screens without a dock. One per app, in the shell; any control
 * calls `showShopNote`. It rises above the tab bar (or the bottom edge without one) as a small
 * Graphite pill and fades after 2.5 s, so nothing under the thumb moves.
 */
let current: { text: string; at: number } | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function showShopNote(text: string): void {
  current = { text, at: Date.now() };
  for (const l of listeners) l();
}

export function ShopNote({ tabBar }: { tabBar: boolean }) {
  const note = useSyncExternalStore(subscribe, () => current);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!note) return;
    setOpen(true);
    const id = setTimeout(() => setOpen(false), 2500);
    return () => clearTimeout(id);
  }, [note]);
  return (
    <>
      <span role="status" className="sr-only">
        {open ? note?.text : ''}
      </span>
      <span
        aria-hidden="true"
        data-open={open ? '' : undefined}
        data-testid="shop-note"
        style={{
          bottom: tabBar
            ? 'calc(var(--tabbar-h) + var(--tabbar-inset) + var(--safe-b, 0px) + 12px)'
            : 'calc(max(12px, var(--safe-b, 0px)) + 76px)',
        }}
        className="type-caption pointer-events-none fixed left-1/2 z-30 -translate-x-1/2 translate-y-1 rounded-pill bg-btn px-3 py-1.5 font-semibold whitespace-nowrap text-btn-ink opacity-0 transition-[opacity,translate] duration-150 ease-out data-[open]:translate-y-0 data-[open]:opacity-100 data-[open]:duration-200"
      >
        {note?.text}
      </span>
    </>
  );
}

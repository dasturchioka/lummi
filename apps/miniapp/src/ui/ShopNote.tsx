import { useEffect, useState, useSyncExternalStore } from 'react';
import { DockNote } from './DockNote';
import { shopNote, subscribeShopNote } from './ShopNoteHost';

/**
 * The card dock's `DockNote` for screens without a dock (the list «+»): the same small pill,
 * fixed above the tab bar (or the bottom edge without one), fading after 2.5 s, so nothing under
 * the thumb moves. A note belongs to the screen it was left on: another screen opens without it
 * (the cart's totals and order button sit right where it would be). Loaded by `ShopNoteHost` with
 * the first note.
 */
export function ShopNote({ tabBar, screen }: { tabBar: boolean; screen?: string }) {
  const note = useSyncExternalStore(subscribeShopNote, shopNote);
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(screen);
  if (screen !== on) {
    setOn(screen);
    setOpen(false);
  }
  useEffect(() => {
    if (!note) return;
    setOpen(true);
    const id = setTimeout(() => setOpen(false), 2500);
    return () => clearTimeout(id);
  }, [note]);
  return (
    // A zero-size anchor: the pill rises 22 px above it, centred, as above a dock.
    <div
      className="pointer-events-none fixed left-1/2 z-30"
      style={{
        bottom: tabBar
          ? 'calc(var(--tabbar-h) + var(--tabbar-inset) + var(--safe-b, 0px) - 10px)'
          : 'calc(max(12px, var(--safe-b, 0px)) + 54px)',
      }}
    >
      <DockNote text={open ? note?.text : undefined} testId="shop-note" />
    </div>
  );
}

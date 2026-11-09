import { useEffect, useRef, useState, type ReactNode } from 'react';

const GUTTER_L = 'max(var(--gutter), var(--safe-l, 0px))';
const GUTTER_R = 'max(var(--gutter), var(--safe-r, 0px))';

/**
 * Page layout every screen uses. It owns the device safe areas and the clearance under the
 * floating tab bar (`--tabbar-clear`), so screens never repeat that arithmetic. It is a column
 * at least the viewport tall, so a `fill` state can take the free height and centre itself.
 *
 * `bleed` drops the top safe-area and side gutters for a full-width first block (Home's
 * fabric top block); that block then handles its own top inset.
 * `tabBar={false}` for the screens shown without the tab bar (the sign-in states, task screens).
 * `dock` is the bottom zone of a task screen (DESIGN.md Layout): a Milk bar with a top hairline,
 * edge to edge, that stays on screen while the content scrolls under it and sits above the bottom
 * safe area. It implies no tab bar.
 * `header` is its mirror at the top (the search field): edge to edge on the Milk ground, it stays
 * put while the content scrolls under it, so the field is never scrolled away when the keyboard
 * has shrunk the viewport. A hairline appears under it once something is under it.
 */
export function Screen({
  children,
  bleed = false,
  tabBar = true,
  dock,
  header,
}: {
  children: ReactNode;
  bleed?: boolean;
  tabBar?: boolean;
  dock?: ReactNode;
  header?: ReactNode;
}) {
  return (
    <main
      className="mx-auto flex min-h-[var(--tg-viewport-stable-height,100dvh)] w-full max-w-[520px] flex-col"
      style={{
        paddingBottom: dock ? 0 : tabBar ? 'var(--tabbar-clear)' : 'max(16px, var(--safe-b, 0px))',
        ...(bleed
          ? undefined
          : {
              // A header covers the top safe area itself, so it can stick at the very top.
              paddingTop: header ? 0 : 'var(--safe-t, 0px)',
              paddingLeft: GUTTER_L,
              paddingRight: GUTTER_R,
            }),
      }}
    >
      {header ? <StickyHeader bleed={bleed}>{header}</StickyHeader> : null}
      {children}
      {dock ? (
        <div
          className="sticky bottom-0 z-20 mt-auto border-t border-line bg-ground pt-2.5"
          style={{
            paddingLeft: GUTTER_L,
            paddingRight: GUTTER_R,
            paddingBottom: 'max(12px, var(--safe-b, 0px))',
            ...(bleed
              ? undefined
              : { marginLeft: `calc(-1 * ${GUTTER_L})`, marginRight: `calc(-1 * ${GUTTER_R})` }),
          }}
        >
          {dock}
        </div>
      ) : null}
    </main>
  );
}

/** The `header` slot: sticky at the top, over the top safe area, with a hairline once content scrolls under it. */
function StickyHeader({ children, bleed }: { children: ReactNode; bleed: boolean }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setUnder(e ? !e.isIntersecting : false));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px -mb-px" />
      <div
        className={`sticky top-0 z-20 border-b bg-ground transition-colors duration-200 ${
          under ? 'border-line' : 'border-transparent'
        }`}
        style={{
          paddingTop: 'var(--safe-t, 0px)',
          paddingLeft: GUTTER_L,
          paddingRight: GUTTER_R,
          ...(bleed
            ? undefined
            : { marginLeft: `calc(-1 * ${GUTTER_L})`, marginRight: `calc(-1 * ${GUTTER_R})` }),
        }}
      >
        {children}
      </div>
    </>
  );
}

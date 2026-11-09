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
 * `lead` sits above a `header` and scrolls away while the header stays (the catalog's title over
 * its search field and type chips).
 * `footer` closes a tab screen whose last block carries its action (the cart's totals with
 * «Оформить заказ»): it follows the content and, on a phone tall enough to spare the room, stays
 * above the floating tab bar while the content scrolls under it. It paints the Milk ground down to
 * the screen edge, so nothing scrolls visibly around the bar or under the home indicator, and a
 * hairline appears over it once something is under it.
 */
export function Screen({
  children,
  bleed = false,
  tabBar = true,
  dock,
  header,
  lead,
  footer,
}: {
  children: ReactNode;
  bleed?: boolean;
  tabBar?: boolean;
  dock?: ReactNode;
  header?: ReactNode;
  lead?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      className="mx-auto flex min-h-[var(--tg-viewport-stable-height,100dvh)] w-full max-w-[520px] flex-col"
      style={{
        paddingBottom:
          dock || footer ? 0 : tabBar ? 'var(--tabbar-clear)' : 'max(16px, var(--safe-b, 0px))',
        ...(bleed
          ? undefined
          : {
              // A header covers the top safe area itself, so it can stick at the very top.
              paddingTop: header && !lead ? 0 : 'var(--safe-t, 0px)',
              paddingLeft: GUTTER_L,
              paddingRight: GUTTER_R,
            }),
      }}
    >
      {lead}
      {header ? <StickyHeader bleed={bleed}>{header}</StickyHeader> : null}
      {children}
      {footer ? (
        <StickyFooter bleed={bleed} tabBar={tabBar}>
          {footer}
        </StickyFooter>
      ) : null}
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

/**
 * The `footer` slot: in the flow after the content, sticky at the bottom from a 680 px viewport
 * (below that it would leave too little room for the content). The hairline shows while the
 * content runs on under it, that is while the footer sits above its own place in the flow.
 */
function StickyFooter({
  children,
  bleed,
  tabBar,
}: {
  children: ReactNode;
  bleed: boolean;
  tabBar: boolean;
}) {
  const mark = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const m = mark.current;
    const f = footer.current;
    if (!m || !f) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setUnder(m.getBoundingClientRect().top > f.getBoundingClientRect().top + 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Lines added or removed move the footer's place without a scroll.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (f.parentElement) ro?.observe(f.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, []);
  return (
    <>
      <div ref={mark} aria-hidden="true" />
      <div
        ref={footer}
        data-under={under || undefined}
        className="relative bottom-0 z-20 bg-ground pt-3 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-line before:opacity-0 before:transition-opacity before:duration-200 data-[under]:before:opacity-100 [@media(min-height:680px)]:sticky"
        style={{
          paddingLeft: GUTTER_L,
          paddingRight: GUTTER_R,
          // Above the floating bar with a 20 px gap (the bar's own side inset), or the bottom safe area.
          paddingBottom: tabBar
            ? 'calc(var(--tabbar-h) + var(--tabbar-inset) + var(--safe-b, 0px) + 20px)'
            : 'max(16px, var(--safe-b, 0px))',
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

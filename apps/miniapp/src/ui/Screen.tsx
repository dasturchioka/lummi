import type { ReactNode } from 'react';

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
 */
export function Screen({
  children,
  bleed = false,
  tabBar = true,
  dock,
}: {
  children: ReactNode;
  bleed?: boolean;
  tabBar?: boolean;
  dock?: ReactNode;
}) {
  return (
    <main
      className="mx-auto flex min-h-[var(--tg-viewport-stable-height,100dvh)] w-full max-w-[520px] flex-col"
      style={{
        paddingBottom: dock ? 0 : tabBar ? 'var(--tabbar-clear)' : 'max(16px, var(--safe-b, 0px))',
        ...(bleed
          ? undefined
          : { paddingTop: 'var(--safe-t, 0px)', paddingLeft: GUTTER_L, paddingRight: GUTTER_R }),
      }}
    >
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

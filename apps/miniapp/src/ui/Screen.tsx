import type { ReactNode } from 'react';

/**
 * Page layout every screen uses. It owns the device safe areas and the clearance under the
 * floating tab bar (`--tabbar-clear`), so screens never repeat that arithmetic. It is a column
 * at least the viewport tall, so a `fill` state can take the free height and centre itself.
 *
 * `bleed` drops the top safe-area and side gutters for a full-width first block (Home's
 * fabric top block); that block then handles its own top inset.
 * `tabBar={false}` for the screens shown without the tab bar (the sign-in states).
 */
export function Screen({
  children,
  bleed = false,
  tabBar = true,
}: {
  children: ReactNode;
  bleed?: boolean;
  tabBar?: boolean;
}) {
  return (
    <main
      className="mx-auto flex min-h-[var(--tg-viewport-stable-height,100dvh)] w-full max-w-[520px] flex-col"
      style={{
        paddingBottom: tabBar ? 'var(--tabbar-clear)' : 'max(16px, var(--safe-b, 0px))',
        ...(bleed
          ? undefined
          : {
              paddingTop: 'var(--safe-t, 0px)',
              paddingLeft: 'max(var(--gutter), var(--safe-l, 0px))',
              paddingRight: 'max(var(--gutter), var(--safe-r, 0px))',
            }),
      }}
    >
      {children}
    </main>
  );
}

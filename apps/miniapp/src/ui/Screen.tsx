import type { ReactNode } from 'react';

/**
 * Page layout every tab screen uses. It owns the device safe areas and the clearance under the
 * floating tab bar (`--tabbar-clear`), so screens never repeat that arithmetic.
 *
 * `bleed` drops the top safe-area and side gutters for a full-width first block (Home's
 * fabric top block); that block then handles its own top inset.
 */
export function Screen({ children, bleed = false }: { children: ReactNode; bleed?: boolean }) {
  return (
    <main
      className="mx-auto w-full max-w-[520px] pb-[var(--tabbar-clear)]"
      style={
        bleed
          ? undefined
          : {
              paddingTop: 'var(--safe-t, 0px)',
              paddingLeft: 'max(var(--gutter), var(--safe-l, 0px))',
              paddingRight: 'max(var(--gutter), var(--safe-r, 0px))',
            }
      }
    >
      {children}
    </main>
  );
}

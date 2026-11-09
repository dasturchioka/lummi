import type { ReactNode } from 'react';

/** Telegram draws the top header; this is only the screen's own title line below it. */
export function ScreenHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <header className="flex min-h-12 items-center justify-between gap-3 pt-3 pb-4">
      <h1 className="type-title text-ink">{title}</h1>
      {trailing}
    </header>
  );
}

/** Page column: 16 px gutters, content clears the floating tab bar and the home indicator. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <main
      className="mx-auto w-full max-w-[520px] px-4"
      style={{
        paddingTop: 'var(--safe-t, 0px)',
        paddingLeft: 'max(16px, var(--safe-l, 0px))',
        paddingRight: 'max(16px, var(--safe-r, 0px))',
        paddingBottom:
          'calc(var(--tabbar-h) + var(--tabbar-inset) * 2 + var(--safe-b, 0px) + 16px)',
      }}
    >
      {children}
    </main>
  );
}

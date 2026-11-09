import type { ReactNode } from 'react';

/**
 * Telegram draws the top header; this is only the screen's own title line below it:
 * Tenor caps at 22 px, 20 px under Telegram's header, 16 px above the content.
 */
export function ScreenHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <header className="flex min-h-[72px] items-center justify-between gap-3 pt-5 pb-4">
      <h1 className="type-title min-w-0 text-ink [overflow-wrap:anywhere]">{title}</h1>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </header>
  );
}

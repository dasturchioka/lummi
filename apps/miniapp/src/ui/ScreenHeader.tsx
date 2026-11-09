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

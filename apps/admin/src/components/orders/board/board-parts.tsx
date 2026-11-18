'use client';

import type { AdminBoardColumnDto, OrderStatus } from '@lummi/contracts';
import { ChevronRight, X } from 'lucide-react';
import { Settle } from '@/components/home/home-parts';
import { cn } from '@/lib/utils';

/*
 * Small pieces of the orders board (#52): the funnel line over it, the skeleton column of the
 * first load, and the one polite live region that speaks (and, for a refusal, shows) what
 * happened to a move.
 */

/**
 * The funnel line: the funnel's statuses with their counts, chevrons between them, then the closed
 * outcomes after a hairline (they end the funnel, they are not a step of it). A press scrolls its
 * column to the board's left edge. One line that scrolls on phones and wraps where the screen is
 * too narrow for it.
 */
export function FunnelLine({
  statuses,
  outcomes = [],
  column,
  name,
  label,
  onJump,
}: {
  statuses: readonly OrderStatus[];
  /** The closed outcomes, after the funnel's steps (#66). */
  outcomes?: readonly OrderStatus[];
  column: (s: OrderStatus) => AdminBoardColumnDto | undefined;
  name: (s: OrderStatus) => string;
  label: string;
  onJump: (s: OrderStatus) => void;
}) {
  return (
    <nav
      aria-label={label}
      className="-mx-1 mb-2 overflow-x-auto [scrollbar-width:none] max-sm:-mr-4 max-sm:pr-4"
    >
      <ol className="flex items-center whitespace-nowrap sm:flex-wrap">
        {[...statuses, ...outcomes].map((s, i) => {
          const c = column(s);
          const outcome = i >= statuses.length;
          return (
            <li key={s} className="flex items-center">
              {i > 0 && !outcome && (
                <ChevronRight
                  aria-hidden
                  className="size-3.5 shrink-0 text-faint"
                  strokeWidth={1.5}
                />
              )}
              {i === statuses.length && i > 0 && (
                <span aria-hidden className="mx-2 h-4 w-px shrink-0 bg-border-strong" />
              )}
              <button
                type="button"
                onClick={() => onJump(s)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-button px-1.5 text-[13px] transition-[background-color,color] duration-150 ease-out hover:bg-field',
                  c && c.count > 0 ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {name(s)}
                <span className="font-semibold tabular-nums">
                  {c ? <Settle value={String(c.count)} /> : '·'}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A column before the first board: its head is known, its cards breathe in Milk Field. */
export function SkeletonColumn({ name, width }: { name: string; width: number | null }) {
  return (
    <section
      className="flex h-full w-[264px] shrink-0 snap-start flex-col rounded-card bg-field max-sm:w-[calc(100vw-88px)]"
      style={width ? { width } : undefined}
    >
      <header className="px-2.5 pt-2 pb-1.5">
        <div className="flex min-h-9 items-start">
          <h2 className="line-clamp-2 text-[13px] leading-[18px] font-semibold text-muted-foreground">
            {name}
          </h2>
        </div>
        <p className="h-[18px]" />
      </header>
      <div className="grid gap-1.5 px-1.5">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-2 rounded-card bg-card px-2.5 py-3">
            <div className="skeleton h-3.5 w-14" />
            <div className="skeleton h-3.5 w-24" />
            <div className="skeleton h-3 w-20" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The board's one polite live region: a refusal shows as a Graphite block at the bottom of the
 * content column for a while (with a close button); a move that went through is only spoken.
 */
export function BoardVoice({
  toast,
  said,
  dismiss,
  onClose,
}: {
  toast: { text: string; key: number } | null;
  said: string;
  dismiss: string;
  onClose: () => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[65] flex justify-center px-4 lg:left-[280px]"
    >
      {toast ? (
        <div
          key={toast.key}
          className="motion-toast pointer-events-auto flex max-w-[min(520px,100%)] items-start gap-3 rounded-card bg-graphite py-3 pr-2 pl-4 text-[13.5px] leading-snug text-milk"
          data-board-toast
        >
          <p className="min-w-0 py-1 text-pretty [overflow-wrap:anywhere]">{toast.text}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={dismiss}
            className="grid size-8 shrink-0 place-items-center rounded-button text-milk/70 transition-[background-color,color] duration-150 hover:bg-milk/10 hover:text-milk"
          >
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ) : (
        <p className="sr-only">{said}</p>
      )}
    </div>
  );
}

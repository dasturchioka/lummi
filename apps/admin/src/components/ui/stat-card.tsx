import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Figure cards: one white card per figure on the Milk ground (the Home's sales strip, the sales
 * report's totals). Flat like every card: tone, not shadow. Top row: the figure's line icon on a
 * Milk Field tile, and an optional `aside` at the right (the 14 bars). Then the value, the label
 * that names its measure, and an optional note (the change) right under it. The label comes first
 * in the DOM, so a screen reader says «Поступило, 4 250 000 сум»; the value is drawn above it.
 */

/** The cards' grid: two columns, four once the content column holds them (a container query). */
export function StatGrid({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      className={cn('grid grid-cols-2 gap-2 sm:gap-3 @4xl:grid-cols-4 @4xl:gap-4', className)}
      {...props}
    />
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  aside,
}: {
  icon: LucideIcon;
  label: ReactNode;
  /** The figure, usually a `StatAmount`. */
  value: ReactNode;
  /** A muted line under the label: the change against the comparison. */
  note?: ReactNode;
  /** The top row's right end, as tall as the icon tile. */
  aside?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col rounded-card bg-card p-3.5 sm:p-[18px]">
      <div className="flex h-9 items-start justify-between gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-button bg-field"
        >
          <Icon className="size-[18px]" strokeWidth={1.5} />
        </span>
        {aside}
      </div>
      <p className="order-2 mt-1 text-[13px] leading-[1.35] text-muted-foreground sm:text-sm">
        {label}
      </p>
      <p className="order-1 mt-4 text-[21px] leading-[1.15] font-semibold tabular-nums sm:mt-5 sm:text-2xl">
        {value}
      </p>
      {note !== undefined && (
        <p className="order-3 mt-1.5 text-small text-muted-foreground">{note}</p>
      )}
    </li>
  );
}

/**
 * A formatted amount with its currency word set smaller and muted beside it: «4 250 000 сум».
 * The number never breaks; on a narrow card the word steps under it instead of being clipped.
 */
export function StatAmount({ text }: { text: string }) {
  const m = /^(.*\d)\s(\D+)$/u.exec(text);
  if (!m) return <span className="whitespace-nowrap">{text}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className="whitespace-nowrap">{m[1]}</span>
      <span className="text-[13px] font-medium whitespace-nowrap text-muted-foreground sm:text-sm">
        {m[2]}
      </span>
    </span>
  );
}

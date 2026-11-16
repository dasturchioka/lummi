import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Figure cards: one white card per figure on the Milk ground (the Home's sales strip, the sales
 * report's totals). Flat like every card: tone, not shadow. Top row: the figure's line icon on a
 * Milk Field tile, and at the right an optional `aside` (the 14 bars) and, on a card that opens a
 * page, the ↗ corner. Then the value, the label that names its measure, and an optional note (the
 * change) right under it. The label comes first in the DOM, so a screen reader says «Поступило,
 * 4 250 000 сум»; the value is drawn above it.
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

const CARD = 'flex min-w-0 flex-col rounded-card bg-card p-3.5 sm:p-[18px]';
/**
 * A card that opens a page. On a fine pointer the hover draws the hairline-strong inset (an outline,
 * not elevation) and nudges the corner; a press sinks it to 0.985. Reduced motion keeps the outline.
 */
const LINKED = cn(
  'group flex-1 transition-[box-shadow,transform] duration-150 ease-out',
  '[@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)]',
  'motion-safe:active:scale-[0.985]',
);

export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  aside,
  href,
}: {
  icon: LucideIcon;
  label: ReactNode;
  /** The figure, usually a `StatAmount`. */
  value: ReactNode;
  /** A muted line under the label: the change against the comparison. */
  note?: ReactNode;
  /** At the top row's right end, as tall as the icon tile. */
  aside?: ReactNode;
  /** The page holding exactly what the figure counts: the whole card opens it. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex h-9 items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-button bg-field"
        >
          <Icon className="size-[18px]" strokeWidth={1.5} />
        </span>
        <span className="ml-auto flex h-full min-w-0 flex-1 items-start justify-end gap-2.5">
          {aside}
          {href && (
            <ArrowUpRight
              aria-hidden
              strokeWidth={1.5}
              className="size-4 shrink-0 text-muted-foreground transition-[color,transform] duration-150 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-foreground motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-px motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:-translate-y-px"
            />
          )}
        </span>
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
    </>
  );
  return href ? (
    <li className="flex min-w-0">
      <Link href={href} className={cn(CARD, LINKED)}>
        {body}
      </Link>
    </li>
  ) : (
    <li className={CARD}>{body}</li>
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

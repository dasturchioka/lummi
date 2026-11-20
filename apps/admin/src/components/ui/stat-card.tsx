import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Figure cards: one white card per figure on the Milk ground (the Home's sales strip, the sales
 * report's totals). Flat like every card: tone, not shadow. The card is a grid and its own
 * container (`card`): top left the figure's line icon on a Milk Field tile, top right an optional
 * `aside` (the 14 bars) and, on a card that opens a page, the ↗ corner; then the value, the label
 * that names its measure, and an optional note (the change). On a narrow card (a phone) the aside
 * drops under the note at full width. The DOM reads label, value, note, then the top row, so a
 * screen reader says «Поступило, 4 250 000 сум» first; the grid draws them as described.
 */

/**
 * The cards' grid: two columns, four once the content column holds them. That is a container
 * query: the caller wraps it in an `@container` (the strip's or the report's section).
 */
export function StatGrid({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      className={cn('grid grid-cols-2 gap-2 sm:gap-3 @4xl:grid-cols-4 @4xl:gap-4', className)}
      {...props}
    />
  );
}

const CARD =
  '@container/card relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 rounded-card bg-card p-3.5 sm:p-[18px]';
/**
 * A card that opens a page. On a fine pointer the hover draws the hairline-strong inset (an outline,
 * not elevation) and nudges the corner; a press sinks it to 0.985. Reduced motion keeps the outline.
 */
const LINKED = cn(
  'group flex-1 transition-[box-shadow,transform] duration-150 ease-out',
  '[@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)]',
  'motion-safe:active:scale-[0.985]',
);
/** Below this card width (a phone's two columns) the aside goes under the note. */
const NARROW_ASIDE =
  '@max-[11.25rem]/card:col-span-2 @max-[11.25rem]/card:col-start-1 @max-[11.25rem]/card:row-start-5 @max-[11.25rem]/card:mt-3 @max-[11.25rem]/card:h-auto @max-[11.25rem]/card:pr-0';

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
  /**
   * Top right, as tall as the icon tile; under the note on a narrow card, where it may show what
   * only its tooltip says on a wide one (`@max-[11.25rem]/card:` variants).
   */
  aside?: ReactNode;
  /** The page listing exactly what the figure is made of: the whole card opens it. */
  href?: string;
}) {
  const body = (
    <>
      <p className="col-span-2 row-start-3 mt-1 text-[13px] leading-[1.35] text-muted-foreground sm:text-sm">
        {label}
      </p>
      {/* a nine-digit sum still fits a 320 px phone's card: the size follows the card's width */}
      <p
        className="col-span-2 row-start-2 mt-4 text-[clamp(17px,14cqi,21px)] leading-[1.15] font-semibold tabular-nums sm:mt-5 sm:text-2xl"
        data-stat-value
      >
        {value}
      </p>
      {note !== undefined && (
        <p className="col-span-2 row-start-4 mt-1.5 text-small text-muted-foreground">{note}</p>
      )}
      <span
        aria-hidden
        className="col-start-1 row-start-1 grid size-9 place-items-center rounded-button bg-field"
      >
        <Icon className="size-[18px]" strokeWidth={1.5} />
      </span>
      {aside && (
        <div
          className={cn(
            'col-start-2 row-start-1 flex h-9 min-w-0 justify-end',
            href && 'pr-[26px]',
            NARROW_ASIDE,
          )}
        >
          {aside}
        </div>
      )}
      {href && (
        <ArrowUpRight
          aria-hidden
          strokeWidth={1.5}
          className="absolute top-3.5 right-3.5 size-4 text-muted-foreground transition-[color,transform] duration-150 ease-out sm:top-[18px] sm:right-[18px] [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-foreground motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-x-px motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:-translate-y-px"
        />
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

'use client';

import { useDroppable } from '@dnd-kit/core';
import type { AdminBoardColumnDto } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import { Settle } from '@/components/home/home-parts';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { boardMoney } from './board-card';

/**
 * What a column is while a card is carried: `home` where it came from, `target` a status it may go
 * to (with the move it would make, `over` while it is held above), `closed` one it cannot reach.
 */
export type Carry =
  { role: 'home' } | { role: 'target'; action: string; over: boolean } | { role: 'closed' };

/** The second line of a column head: its money at rest, the move it offers while a card is carried. */
function Line({
  column,
  carry,
  language,
}: {
  column: AdminBoardColumnDto;
  carry: Carry | null;
  language: Language;
}) {
  if (carry?.role === 'target')
    return (
      <span
        key="action"
        className={cn(
          'motion-swap block truncate',
          carry.over ? 'font-semibold text-foreground' : 'font-medium text-foreground/80',
        )}
      >
        {carry.action}
      </span>
    );
  return (
    <span key="sum" className="block truncate">
      {column.count > 0 ? <Settle value={boardMoney(column.sum, language)} /> : null}
    </span>
  );
}

/**
 * One status as a column (#52): a Milk Field tray (the set box's compartment tray) under a head
 * with the status, its count and the money in it; the cards scroll inside. While a card is carried
 * a column it cannot go to falls to 40 %, and the one it would land in takes the ink outline of
 * the set box's next empty slot.
 */
export function BoardColumn({
  column,
  carry,
  language,
  t,
  listHref,
  onCollapse,
  columnRef,
  children,
  empty,
}: {
  column: AdminBoardColumnDto;
  carry: Carry | null;
  language: Language;
  t: AdminMessages;
  /** The list view filtered to this status, for what the column leaves out. */
  listHref: string;
  /** A closed column opened from its rail folds back. */
  onCollapse?: () => void;
  columnRef?: Ref<HTMLElement>;
  children: ReactNode;
  /** What an empty board says in its first column. */
  empty?: ReactNode;
}) {
  const b = t.orders.board;
  const status = column.status;
  const name = ordersMessages[language].orders.status[status];
  const { setNodeRef } = useDroppable({
    id: `col:${status}`,
    data: { status },
    disabled: carry?.role === 'closed',
  });
  const more = column.count - column.cards.length;
  return (
    <section
      ref={(el) => {
        setNodeRef(el);
        if (typeof columnRef === 'function') columnRef(el);
      }}
      aria-labelledby={`board-${status}`}
      className={cn(
        'flex h-full w-[256px] shrink-0 snap-start flex-col rounded-card bg-field max-sm:w-[calc(100vw-88px)]',
        'transition-[opacity,box-shadow] duration-150 ease-out',
        carry?.role === 'closed' && 'opacity-40',
        carry?.role === 'target' && carry.over && 'shadow-[inset_0_0_0_1.5px_var(--graphite)]',
      )}
      data-column={status}
      data-carry={carry?.role}
    >
      <header className="px-3 pt-2.5 pb-2">
        <div className="flex min-h-7 items-center justify-between gap-2">
          <h2
            id={`board-${status}`}
            className="min-w-0 truncate text-[13.5px] leading-snug font-semibold"
          >
            {name}
          </h2>
          <span className="flex items-center gap-1">
            <span className="text-[13px] font-semibold text-muted-foreground tabular-nums">
              <Settle value={String(column.count)} />
            </span>
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label={fill(b.collapse, { status: name })}
                className="relative -mr-1.5 grid size-7 place-items-center rounded-button text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-card hover:text-foreground active:scale-[0.94] after:absolute after:-inset-1.5"
              >
                <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </span>
        </div>
        <p className="h-[18px] text-small leading-[18px] text-muted-foreground tabular-nums">
          <Line column={column} carry={carry} language={language} />
        </p>
      </header>
      <ol className="board-list flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-x-contain px-2 pb-2">
        {empty}
        {children}
        {more > 0 && (
          <li className="pt-1 pb-0.5 text-center">
            <Link
              href={listHref}
              className="rounded-sm text-small font-medium underline decoration-border-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current"
            >
              {fill(b.more, { n: String(more) })}
            </Link>
          </li>
        )}
      </ol>
    </section>
  );
}

/**
 * A closed outcome folded to a rail (#52): «Отменён» and «Возвращён» stay out of the way, docked
 * at the board's right edge from 640 px, yet always in reach as a drop target. The count reads
 * first, the status runs down the rail; while a card is carried a rail it may go to names the
 * move instead. Pressing it opens the column beside it.
 */
export function BoardRail({
  column,
  carry,
  expanded,
  onToggle,
  language,
  t,
}: {
  column: AdminBoardColumnDto;
  carry: Carry | null;
  expanded: boolean;
  onToggle: () => void;
  language: Language;
  t: AdminMessages;
}) {
  const b = t.orders.board;
  const status = column.status;
  const name = ordersMessages[language].orders.status[status];
  const { setNodeRef } = useDroppable({
    id: `rail:${status}`,
    data: { status },
    disabled: carry?.role === 'closed',
  });
  const Chevron = expanded ? ChevronRight : ChevronLeft;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={fill(expanded ? b.collapse : b.expand, { status: name })}
      className={cn(
        'flex h-full w-12 shrink-0 snap-start flex-col items-center gap-2.5 rounded-card bg-field pt-3 pb-3 text-foreground',
        'transition-[opacity,box-shadow,background-color] duration-150 ease-out hover:bg-stone/45',
        expanded && 'shadow-[inset_0_0_0_1px_var(--hairline-strong)]',
        carry?.role === 'closed' && 'opacity-40',
        carry?.role === 'target' && carry.over && 'shadow-[inset_0_0_0_1.5px_var(--graphite)]',
      )}
      data-rail={status}
      data-carry={carry?.role}
    >
      <span className="text-[13px] font-semibold tabular-nums">
        <Settle value={String(column.count)} />
      </span>
      <span
        aria-hidden
        className={cn(
          'min-h-0 flex-1 overflow-hidden text-[13.5px] leading-none whitespace-nowrap [writing-mode:vertical-rl]',
          carry?.role === 'target' ? 'motion-swap font-semibold' : 'font-medium',
        )}
        key={carry?.role === 'target' ? 'action' : 'name'}
      >
        {carry?.role === 'target' ? carry.action : name}
      </span>
      <Chevron className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
    </button>
  );
}

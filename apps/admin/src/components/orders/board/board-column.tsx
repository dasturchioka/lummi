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

/**
 * While a card is carried, a column it may go to becomes one drop slot over its cards: the set
 * box's empty compartment (Milk Field with a dashed hairline). Held above, the slot takes the ink
 * outline of the box's next slot. The move's words are in the column's head, where the carried
 * card never covers them.
 */
function DropSlot({ carry }: { carry: Carry | null }) {
  if (carry?.role !== 'target') return null;
  return (
    // the whole list area goes under Milk Field, so no card shows past the slot's edge
    <div
      aria-hidden
      className="motion-swap pointer-events-none absolute inset-0 z-10 rounded-b-card bg-field/85 p-1.5 pt-0"
      data-drop-slot
    >
      <div
        className={cn(
          'h-full rounded-button transition-[box-shadow] duration-150 ease-out',
          carry.over
            ? 'shadow-[inset_0_0_0_1.5px_var(--graphite)]'
            : 'outline-[1.5px] outline-offset-[-1.5px] outline-border-strong outline-dashed',
        )}
      />
    </div>
  );
}

/**
 * One status as a column (#52): a Milk Field tray (the set box's compartment tray) under a head
 * with the status (two lines at most), its count and the money in it, as the server last added it
 * up; the cards scroll inside. While a card is carried a column it cannot go to falls to 40 %, and
 * one it may go to shows its drop slot.
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
  width,
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
  /** What an empty shop says in its first column. */
  empty?: ReactNode;
  /** From 640 px the board sizes its columns to the room it has. */
  width?: number | null;
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
        'transition-opacity duration-150 ease-out',
        carry?.role === 'closed' && 'opacity-40',
      )}
      style={width ? { width } : undefined}
      data-column={status}
      data-carry={carry?.role}
      data-over={carry?.role === 'target' && carry.over ? '' : undefined}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-1.5 px-2.5 pt-2 pb-1.5">
        {/* at rest the status and its money; while a card is carried here, the move in full */}
        <div className="min-h-[54px] min-w-0">
          <h2
            id={`board-${status}`}
            className={cn(
              'line-clamp-2 min-h-9 text-[13px] leading-[18px] font-semibold text-balance',
              carry?.role === 'target' && 'sr-only',
            )}
          >
            {name}
          </h2>
          {carry?.role === 'target' ? (
            <p
              key="move"
              className={cn(
                'motion-swap line-clamp-3 text-[13px] leading-[18px] text-balance',
                carry.over ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
              )}
              data-move-label
            >
              {carry.action}
            </p>
          ) : (
            <p
              key="money"
              className="h-[18px] truncate text-small leading-[18px] text-muted-foreground tabular-nums"
            >
              {column.count > 0 ? <Settle value={boardMoney(column.sum, language)} /> : null}
            </p>
          )}
        </div>
        <span className="flex h-[18px] items-center gap-0.5">
          <span className="text-[13px] leading-[18px] font-semibold text-muted-foreground tabular-nums">
            <Settle value={String(column.count)} />
          </span>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label={fill(b.collapse, { status: name })}
              className="relative -mr-1 grid size-6 place-items-center rounded-[6px] text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out after:absolute after:-inset-2 hover:bg-card hover:text-foreground active:scale-[0.94]"
            >
              <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </span>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ol className="board-list flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-x-contain px-1.5 pb-1.5">
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
        <DropSlot carry={carry} />
      </div>
    </section>
  );
}

/**
 * A closed outcome folded to a rail (#52): «Отменён» and «Возвращён» stay out of the way beside
 * the board from 640 px (at its end on phones), yet always in reach as a drop target. The count
 * reads first, the status runs down the rail; while a card is carried a rail it may go to names
 * the move in full instead. Pressing it opens the column in its place (its head folds it back).
 */
export function BoardRail({
  column,
  carry,
  onOpen,
  language,
  t,
}: {
  column: AdminBoardColumnDto;
  carry: Carry | null;
  onOpen: () => void;
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
  const target = carry?.role === 'target';
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      aria-label={fill(b.expand, { status: name })}
      className={cn(
        'flex h-full w-11 shrink-0 snap-start flex-col items-center gap-2.5 rounded-card bg-field pt-3 pb-3 text-foreground',
        'transition-[opacity,box-shadow,background-color] duration-150 ease-out hover:bg-stone/45',
        carry?.role === 'closed' && 'opacity-40',
        target &&
          (carry.over
            ? 'shadow-[inset_0_0_0_1.5px_var(--graphite)]'
            : 'outline-[1.5px] outline-offset-[-1.5px] outline-border-strong outline-dashed'),
      )}
      data-rail={status}
      data-carry={carry?.role}
      data-over={target && carry.over ? '' : undefined}
    >
      <span className="text-[13px] font-semibold tabular-nums">
        <Settle value={String(column.count)} />
      </span>
      <span
        aria-hidden
        className={cn(
          'min-h-0 flex-1 overflow-hidden text-[13.5px] leading-none whitespace-nowrap [writing-mode:vertical-rl]',
          target ? 'motion-swap font-semibold' : 'font-medium',
        )}
        key={target ? 'action' : 'name'}
      >
        {target ? carry.action : name}
      </span>
      <ChevronLeft
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
    </button>
  );
}

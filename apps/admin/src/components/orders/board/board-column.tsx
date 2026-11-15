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
 * box's empty compartment (a dashed hairline on Milk Field) naming the move in full, on as many
 * lines as the words need. Held above, the slot takes the ink outline of the box's next slot.
 */
function DropSlot({ carry }: { carry: Carry | null }) {
  if (carry?.role !== 'target') return null;
  return (
    <div
      aria-hidden
      className={cn(
        'motion-swap pointer-events-none absolute inset-x-1.5 top-0 bottom-1.5 z-10 grid place-items-center rounded-button bg-field/90 px-3 text-center',
        'text-[13.5px] leading-snug text-pretty transition-[box-shadow,color] duration-150 ease-out',
        carry.over
          ? 'font-semibold text-foreground shadow-[inset_0_0_0_1.5px_var(--graphite)]'
          : 'font-medium text-muted-foreground outline-[1.5px] outline-offset-[-1.5px] outline-border-strong outline-dashed',
      )}
      data-drop-slot
    >
      {carry.action}
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
      <header className="px-2.5 pt-2 pb-1.5">
        <div className="flex min-h-9 items-start justify-between gap-1.5">
          <h2
            id={`board-${status}`}
            className="line-clamp-2 min-w-0 text-[13px] leading-[18px] font-semibold text-balance"
          >
            {name}
          </h2>
          <span className="flex items-center gap-0.5">
            <span className="text-[13px] leading-[18px] font-semibold text-muted-foreground tabular-nums">
              <Settle value={String(column.count)} />
            </span>
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label={fill(b.collapse, { status: name })}
                className="relative -my-1 -mr-1 grid size-6 place-items-center rounded-[6px] text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out after:absolute after:-inset-2 hover:bg-card hover:text-foreground active:scale-[0.94]"
              >
                <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </span>
        </div>
        <p className="h-[18px] truncate text-small leading-[18px] text-muted-foreground tabular-nums">
          {column.count > 0 ? <Settle value={boardMoney(column.sum, language)} /> : null}
        </p>
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

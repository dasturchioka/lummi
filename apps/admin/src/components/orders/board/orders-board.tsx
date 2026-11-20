'use client';

import { DndContext, DragOverlay, MeasuringStrategy, type DragEndEvent } from '@dnd-kit/core';
import {
  BOARD_STATUSES,
  staffMove,
  staffTargets,
  utcToTashkent,
  type AdminBoardCardDto,
  type AdminOrdersBoardDto,
  type AdminOrdersBoardQuery,
  type OrderStatus,
} from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { useVisiblePoll } from '@/lib/use-visible-poll';
import { fill } from '@/lib/utils';
import type { OrderFilters } from '../orders-filters';
import { BoardCard, CardBody, type Target } from './board-card';
import { BoardColumn, type Carry } from './board-column';
import { BoardDialogs } from './board-dialogs';
import {
  boardAnnouncements,
  cardOf,
  collide,
  dropAnimation,
  keepOnScreen,
  statusOf,
  useBoardSensors,
} from './board-dnd';
import { useColumnLayout, useFillHeight, useReducedMotion, useWide } from './board-layout';
import { BoardVoice, FunnelLine, SkeletonColumn } from './board-parts';
import { arrivals, moveKind, moveLabel, withMoves } from './board-state';
import { useBoardMoves } from './use-board-moves';

/** The funnel's steps: «Ожидает оплаты» … «Доставлен». */
const FUNNEL_COLUMNS: OrderStatus[] = BOARD_STATUSES.filter(
  (s) => s !== 'cancelled' && s !== 'returned',
);
/** The closed outcomes, after the funnel. */
const OUTCOME_COLUMNS: OrderStatus[] = ['cancelled', 'returned'];
/**
 * Every column, the same width and form, none folded (#66, Nurmuhammad 2026-11-17: like Reveo's
 * funnel, one view): the funnel's steps, then the closed outcomes at the end.
 */
const COLUMNS: OrderStatus[] = [...FUNNEL_COLUMNS, ...OUTCOME_COLUMNS];

const TEXT_LINK =
  'font-medium text-foreground underline decoration-border-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current';

/**
 * The orders board (#52): the statuses as columns, cards are orders. One call
 * (`GET /admin/orders/board`), again every `LIVE_POLL_MS` while the tab is visible and on focus
 * (feedback F12, «real time»), but never applied while a card is carried or a move waits: a fresh
 * board follows once it is free. New filters remount it (the page keys it by them). Moves live in
 * `useBoardMoves`, carrying in `board-dnd`, the room in `board-layout`.
 */
export function OrdersBoard({
  t,
  language,
  filters,
}: {
  t: AdminMessages;
  language: Language;
  filters: OrderFilters;
}) {
  const o = t.orders;
  const b = o.board;
  const statusName = useCallback(
    (s: OrderStatus) => ordersMessages[language].orders.status[s],
    [language],
  );
  const router = useRouter();
  const query = useMemo<AdminOrdersBoardQuery>(() => {
    const { q, payment, from, to } = filters;
    return {
      ...(q ? { q } : {}),
      ...(payment ? { payment: payment as AdminOrdersBoardQuery['payment'] } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }, [filters]);
  const filtered = Object.keys(query).length > 0;

  const [board, setBoard] = useState<AdminOrdersBoardDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [arrived, setArrived] = useState<Set<number>>(() => new Set());
  const [carried, setCarried] = useState<AdminBoardCardDto | null>(null);
  const [overStatus, setOverStatus] = useState<OrderStatus | null>(null);
  const [landed, setLanded] = useState(false);

  const boardRef = useRef(board);
  boardRef.current = board;
  /** When the shown board arrived, to tell the server's now at the moment of a move. */
  const receivedAt = useRef(0);
  const busy = useRef(false);
  const stale = useRef(false);
  const columnEls = useRef(new Map<OrderStatus, HTMLElement>());

  const moves = useBoardMoves({
    t,
    language,
    statusName,
    serverNow: () =>
      new Date(
        Date.parse(boardRef.current?.at ?? new Date().toISOString()) +
          Date.now() -
          receivedAt.current,
      ).toISOString(),
    onSettled: () => {
      stale.current = true;
    },
  });
  const movesRef = useRef(moves.moves);
  movesRef.current = moves.moves;
  const pending = moves.moves.some((m) => m.state !== 'done');
  busy.current = carried !== null || moves.dialog !== null || pending;

  // live (#53's shared poll): the first board at once, then every 10 s while visible and on focus
  const { refresh } = useVisiblePoll(
    async (signal) => {
      if (busy.current) {
        stale.current = true;
        return;
      }
      const started = moves.epoch.current;
      try {
        const res = await browserApi.orders.board({ query, fetchOptions: { signal } });
        if (signal.aborted) return;
        if (res.status === 401) return router.replace('/login');
        if (res.status !== 200) throw new Error(`board ${res.status}`);
        // a move or a pick-up happened meanwhile: this board is older than what is shown
        if (started !== moves.epoch.current || busy.current) {
          stale.current = true;
          return;
        }
        const keep = movesRef.current.filter((m) => m.state !== 'done');
        const before = boardRef.current ? withMoves(boardRef.current, movesRef.current) : null;
        setArrived(arrivals(before, withMoves(res.body, keep)));
        receivedAt.current = Date.now();
        setBoard(res.body);
        moves.setMoves(keep);
        setFailed(false);
      } catch {
        if (signal.aborted) return;
        if (!boardRef.current) setFailed(true);
      } finally {
        if (!signal.aborted) setRetrying(false);
      }
    },
    { immediate: true },
  );

  // a refresh skipped while busy (or asked for by a move that ended) comes once the board is free
  const free = carried === null && moves.dialog === null && !pending;
  useEffect(() => {
    if (free && stale.current) {
      stale.current = false;
      refresh();
    }
  }, [free, refresh, moves.moves]);

  /** A move shown at once: the card settles into its new column (and back home if refused). */
  const move = (card: AdminBoardCardDto, to: OrderStatus) => {
    if (moves.begin(card, to)) setArrived((was) => new Set(was).add(card.number));
  };

  // ---- carrying

  const sensors = useBoardSensors();
  const wide = useWide();
  const reduced = useReducedMotion();

  const carryOf = (status: OrderStatus): Carry | null => {
    if (!carried) return null;
    if (status === carried.status) return { role: 'home' };
    const row = staffMove(carried.status, status);
    if (!row) return { role: 'closed' };
    return { role: 'target', action: moveLabel(row.action, t), over: overStatus === status };
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const card = cardOf(active.data.current);
    const to = statusOf(over?.data.current);
    setCarried(null);
    setOverStatus(null);
    if (card && to && to !== card.status && staffMove(card.status, to)) {
      setLanded(true);
      move(card, to);
    }
  };

  // ---- what is shown

  const columns = board ? withMoves(board, moves.moves) : null;
  const column = (s: OrderStatus) => columns?.find((c) => c.status === s);
  const moveOf = (number: number) => moves.moves.find((m) => m.number === number);
  const allEmpty = columns?.every((c) => c.count === 0) ?? false;

  const targetsOf = (card: AdminBoardCardDto): Target[] =>
    staffTargets(card.status).map((status) => {
      const row = staffMove(card.status, status)!;
      return { status, asks: moveKind(row.action) !== 'step' };
    });

  /** The funnel line's press: its column to the board's left edge. */
  const jump = (s: OrderStatus) =>
    columnEls.current.get(s)?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      inline: 'start',
      block: 'nearest',
    });

  const { ref: frame, height } = useFillHeight();
  const { ref: scroller, layout } = useColumnLayout(COLUMNS.length);
  /** Marks the edges the board continues past, for their fade (globals.css). */
  const markEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    el.toggleAttribute('data-more-start', el.scrollLeft > 1);
    el.toggleAttribute('data-more-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, [scroller]);
  useEffect(markEdges);
  const width = layout?.width ?? null;
  const listFor = (s?: OrderStatus) =>
    listHref('/orders', { view: 'list', ...filters, ...(s ? { status: s } : {}) });
  const updated = board ? utcToTashkent(new Date(board.at)) : null;
  const pad = (n: number) => String(n).padStart(2, '0');

  const renderColumn = (s: OrderStatus) => {
    const c = column(s);
    if (!c || !board) return null;
    return (
      <BoardColumn
        key={s}
        column={c}
        width={width}
        carry={carryOf(s)}
        language={language}
        t={t}
        listHref={listFor(s)}
        columnRef={(el) => {
          if (el) columnEls.current.set(s, el);
          else columnEls.current.delete(s);
        }}
        empty={
          !board.shopHasOrders && s === 'awaiting_payment' ? (
            <li
              className="grid gap-0.5 rounded-card border-[1.5px] border-dashed border-border-strong px-2.5 py-3.5"
              data-empty-slot
            >
              <span className="text-[13.5px] font-semibold text-balance">{b.empty}</span>
              <span className="text-small text-pretty text-muted-foreground">{b.emptySlot}</span>
            </li>
          ) : undefined
        }
      >
        {c.cards.map((card) => {
          const m = moveOf(card.number);
          return (
            <BoardCard
              key={card.number}
              card={card}
              at={board.at}
              t={t}
              language={language}
              targets={targetsOf(card)}
              onMove={(to) => move(card, to)}
              waiting={m !== undefined && m.state !== 'done'}
              arrived={arrived.has(card.number)}
              locked={moves.dialog !== null}
            />
          );
        })}
      </BoardColumn>
    );
  };

  if (failed && !board)
    return (
      <EmptyState
        tone="error"
        title={b.failed}
        action={
          <Button
            loading={retrying}
            onClick={() => {
              setRetrying(true);
              refresh();
            }}
          >
            {t.actions.retry}
          </Button>
        }
      />
    );

  return (
    <div
      ref={frame}
      className="flex flex-col"
      style={{ height }}
      data-board
      aria-busy={board ? undefined : true}
    >
      <FunnelLine
        statuses={FUNNEL_COLUMNS}
        outcomes={OUTCOME_COLUMNS}
        column={column}
        name={statusName}
        label={b.funnel}
        onJump={jump}
      />
      {board && allEmpty && (filtered || board.shopHasOrders) && (
        <p className="mb-2 text-[13.5px] text-pretty" role="status" data-board-note>
          <span className="font-semibold">
            {filtered
              ? o.emptyFiltered
              : fill(plural(language, board.recentDays, b.quiet), {
                  n: String(board.recentDays),
                })}
          </span>{' '}
          {!filtered && (
            <Link href={listFor()} className={TEXT_LINK}>
              {b.allInList}
            </Link>
          )}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collide}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        // phones: a carried card near the edge brings the next column fully in, readable
        autoScroll={
          wide
            ? { threshold: { x: 0.08, y: 0.18 } }
            : { threshold: { x: 0.22, y: 0.18 }, acceleration: 6 }
        }
        accessibility={{
          announcements: boardAnnouncements(t, statusName),
          screenReaderInstructions: { draggable: b.instructions },
        }}
        onDragStart={({ active }) => {
          setLanded(false);
          setCarried(cardOf(active.data.current));
        }}
        onDragOver={({ over }) => setOverStatus(statusOf(over?.data.current))}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setCarried(null);
          setOverStatus(null);
        }}
      >
        <div
          ref={scroller}
          onScroll={markEdges}
          className="board-scroller -mx-4 flex min-h-0 min-w-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 sm:mx-0 sm:px-0"
          data-carrying={carried ? '' : undefined}
        >
          {columns
            ? COLUMNS.map(renderColumn)
            : COLUMNS.map((s) => <SkeletonColumn key={s} name={statusName(s)} width={width} />)}
          {/* the room after the last column, so the scroll also ends on a whole column */}
          {layout && layout.endPad > 0 && (
            <div aria-hidden className="shrink-0" style={{ width: layout.endPad - 8 }} />
          )}
        </div>
        <DragOverlay
          modifiers={[keepOnScreen]}
          dropAnimation={dropAnimation(landed, reduced)}
          transition={() => undefined}
          zIndex={60}
        >
          {carried && board ? (
            <div className="motion-lift cursor-grabbing rounded-card bg-card px-2 pt-1.5 pb-2.5 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
              <CardBody card={carried} at={board.at} t={t} language={language} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {board && (
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-small text-muted-foreground">
          <p>
            {fill(plural(language, board.recentDays, b.recent), { n: String(board.recentDays) })}
            {' · '}
            <Link href={listFor()} className={TEXT_LINK}>
              {b.allInList}
            </Link>
          </p>
          {updated && (
            <p className="tabular-nums" data-updated>
              {fill(b.updated, { time: `${pad(updated.hour)}:${pad(updated.minute)}` })}
            </p>
          )}
        </div>
      )}

      <BoardVoice
        toast={moves.toast}
        said={moves.said}
        dismiss={b.dismiss}
        onClose={moves.closeToast}
      />
      <BoardDialogs
        dialog={moves.dialog}
        t={t}
        language={language}
        answer={moves.answer}
        dismiss={moves.dismiss}
      />
    </div>
  );
}

'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  BOARD_STATUSES,
  staffMove,
  staffTargets,
  utcToTashkent,
  type AdminBoardCardDto,
  type AdminOrderDto,
  type AdminOrdersBoardDto,
  type AdminOrdersBoardQuery,
  type OrderAction,
  type OrderStatus,
} from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Settle } from '@/components/home/home-parts';
import { Button } from '@/components/ui/button';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { cn, fill } from '@/lib/utils';
import {
  CancelDialog,
  ConfirmPaymentDialog,
  HandToBtsDialog,
  refusalFailure,
  RejectDialog,
  ReturnDialog,
  type Failure,
} from '../order-dialogs';
import type { OrderFilters } from '../orders-filters';
import { BoardCard, CardBody, type Target } from './board-card';
import { BoardColumn, BoardRail, type Carry } from './board-column';
import { arrivals, moveKind, withMoves, type Move, type MoveKind } from './board-state';

/** The board refreshes this often while its tab is visible (feedback F12: «real time»). */
export const BOARD_REFRESH_MS = 10_000;
/** A focus right after a refresh does not fetch again. */
const FOCUS_GAP_MS = 2_000;
/** The board never gets shorter than this, however little room the viewport leaves. */
const MIN_HEIGHT = 440;
/** How long a refusal stays on screen. */
const TOAST_MS = 6_000;

const OPEN = BOARD_STATUSES.filter((s) => s !== 'cancelled' && s !== 'returned');
const CLOSED = ['cancelled', 'returned'] as const satisfies readonly OrderStatus[];

type DialogState = {
  kind: Exclude<MoveKind, 'step'>;
  move: Move;
  page: AdminOrderDto;
  receiptId: number | null;
  key: number;
};
type MoveResponse = Awaited<ReturnType<typeof browserApi.orders.fulfil>>;

/** The move's words, as the order page's buttons name it. */
function actionLabel(action: OrderAction, t: AdminMessages): string {
  const o = t.orders;
  switch (action) {
    case 'accept':
    case 'start_assembly':
    case 'hand_to_bts':
    case 'deliver':
    case 'cancel':
      return o.step[action];
    case 'return':
      return o.ret.action;
    case 'confirm_payment':
      return o.detail.confirm;
    case 'reject_receipt':
      return o.detail.reject;
    default:
      return '';
  }
}

/** The receipt under check, newest first: the one a confirmation or a rejection is about. */
const waitingReceipt = (page: AdminOrderDto) =>
  page.receipts.find((r) => r.verdict === 'pending' || r.verdict === 'manual_review') ?? null;

/**
 * Keyboard carrying hops from column to column: the arrows go to the next column the order may
 * go to (or back home), never 25 px at a time; the rails count as columns.
 */
const columnHop: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') {
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') event.preventDefault();
    return currentCoordinates;
  }
  if (!collisionRect) return undefined;
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => a.left - b.left);
  const centre = collisionRect.left + collisionRect.width / 2;
  const next =
    event.code === 'ArrowRight'
      ? columns.find((r) => r.left > centre)
      : [...columns].reverse().find((r) => r.left + r.width < centre);
  if (!next) return currentCoordinates;
  return {
    x: next.left + (next.width - collisionRect.width) / 2,
    y: Math.min(
      Math.max(currentCoordinates.y, next.top),
      next.top + next.height - collisionRect.height,
    ),
  };
};

/**
 * Under the pointer: a rail wins over the column scrolling beneath it; nothing under the pointer
 * is no target at all. The keyboard (no pointer) takes the column the card overlaps.
 */
const collide: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return rectIntersection(args);
  const hits = pointerWithin(args);
  const rail = hits.find((h) => String(h.id).startsWith('rail:'));
  return rail ? [rail] : hits;
};

/** The lifted card leaves the pointer on the brand ease-out: back home when nothing moved. */
const RETURN: DropAnimation = { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
/** A card that landed: the carried copy fades where it was let go, the card settles in its column. */
const LAND: DropAnimation = {
  duration: 140,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  keyframes: ({ transform }) => {
    const at = `translate3d(${transform.initial.x}px, ${transform.initial.y}px, 0)`;
    return [
      { opacity: 1, transform: at },
      { opacity: 0, transform: `${at} scale(0.98)` },
    ];
  },
  sideEffects: null,
};

/** Fills what the viewport leaves below the board's top (measured), never under `MIN_HEIGHT`. */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top - 16)));
    };
    measure();
    const watch = new ResizeObserver(measure);
    if (el.parentElement) watch.observe(el.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return { ref, height };
}

/**
 * The orders board (#52): the statuses as columns, cards are orders. One call
 * (`GET /admin/orders/board`), again every 10 s while the tab is visible and on focus, but never
 * while a card is carried or a move waits: a fresh board is applied once it is free. A move shows
 * at once; the server decides, and a refusal puts the card back with one sentence.
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
  const [moves, setMoves] = useState<Move[]>([]);
  const [arrived, setArrived] = useState<Set<number>>(() => new Set());
  const [expanded, setExpanded] = useState<OrderStatus[]>([]);
  const [carried, setCarried] = useState<AdminBoardCardDto | null>(null);
  const [overStatus, setOverStatus] = useState<OrderStatus | null>(null);
  const [landing, setLanding] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [said, setSaid] = useState('');

  const boardRef = useRef(board);
  const movesRef = useRef(moves);
  boardRef.current = board;
  movesRef.current = moves;
  /** When the shown board arrived, to tell the server's now at the moment of a move. */
  const receivedAt = useRef(0);
  /** Bumped by every move: an answer to a request sent before it describes an older board. */
  const epoch = useRef(0);
  const busy = useRef(false);
  const stale = useRef(false);
  const inFlight = useRef(false);
  const lastFetch = useRef(0);
  const gone = useRef<AbortController | null>(null);
  const columnEls = useRef(new Map<OrderStatus, HTMLElement>());
  const scroller = useRef<HTMLDivElement>(null);
  busy.current = carried !== null || dialog !== null || moves.some((m) => m.state !== 'done');

  const fetchBoard = useCallback(async () => {
    const view = gone.current;
    if (!view || view.signal.aborted || inFlight.current) return;
    if (busy.current) {
      stale.current = true;
      return;
    }
    inFlight.current = true;
    lastFetch.current = Date.now();
    const started = epoch.current;
    try {
      const res = await browserApi.orders.board({ query, fetchOptions: { signal: view.signal } });
      if (view.signal.aborted) return;
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (res.status !== 200) throw new Error(`board ${res.status}`);
      // a move or a pick-up happened meanwhile: this board is older than what is shown
      if (started !== epoch.current || busy.current) {
        stale.current = true;
        return;
      }
      const keep = movesRef.current.filter((m) => m.state !== 'done');
      const before = boardRef.current ? withMoves(boardRef.current, movesRef.current) : null;
      setArrived(arrivals(before, withMoves(res.body, keep)));
      receivedAt.current = Date.now();
      setBoard(res.body);
      setMoves(keep);
      setFailed(false);
    } catch {
      if (view.signal.aborted) return;
      if (!boardRef.current) setFailed(true);
    } finally {
      inFlight.current = false;
      if (!view.signal.aborted) setRetrying(false);
    }
  }, [query, router]);

  // the first board, then every 10 s while visible and on focus (as the Home does)
  useEffect(() => {
    const view = new AbortController();
    gone.current = view;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      clearInterval(timer);
      timer = setInterval(() => void fetchBoard(), BOARD_REFRESH_MS);
    };
    const refetch = () => {
      if (Date.now() - lastFetch.current <= FOCUS_GAP_MS) return;
      void fetchBoard();
      tick();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return clearInterval(timer);
      refetch();
      tick();
    };
    void fetchBoard();
    if (document.visibilityState === 'visible') tick();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refetch);
    return () => {
      view.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refetch);
    };
  }, [fetchBoard]);

  // a refresh skipped while busy comes as soon as the board is free again
  const free = carried === null && dialog === null && !moves.some((m) => m.state !== 'done');
  useEffect(() => {
    if (free && stale.current) {
      stale.current = false;
      void fetchBoard();
    }
  }, [free, fetchBoard]);

  // a refusal reads for a while, then goes
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const say = (text: string) => setToast({ text, key: Date.now() });
  const serverNow = () =>
    new Date(
      Date.parse(boardRef.current?.at ?? new Date().toISOString()) +
        Date.now() -
        receivedAt.current,
    ).toISOString();

  /** The move is over (either way): the next board is the truth. */
  const settle = (move: Move, outcome: 'done' | 'dropped') => {
    epoch.current += 1;
    setMoves((all) =>
      outcome === 'dropped'
        ? all.filter((m) => m !== move && m.number !== move.number)
        : all.map((m) => (m.number === move.number ? { ...m, state: 'done' } : m)),
    );
    if (outcome === 'done')
      setSaid(fill(b.moved, { number: String(move.number), status: statusName(move.to) }));
    stale.current = true;
  };

  /** A 409 that names how the order is now: why the card goes back. */
  const conflictText = (res: Extract<MoveResponse, { status: 409 }>, number: number) => {
    if (res.body.code === 'try_again') return fill(b.refused.failed, { number: String(number) });
    if (res.body.code === 'receipt_changed') return o.receiptChanged;
    if (res.body.code === 'credit_taken') return o.creditTaken;
    return fill(b.refused.conflict, {
      number: String(number),
      status: statusName(res.body.order.order.status),
    });
  };

  /** A step needs nothing more: it is sent at once (the order page's own press). */
  const step = async (move: Move, action: 'accept' | 'start_assembly' | 'deliver') => {
    const res = await browserApi.orders
      .fulfil({ params: { number: move.number }, body: { action, expectedStatus: move.from } })
      .catch(() => null);
    if (res?.status === 200) return settle(move, 'done');
    settle(move, 'dropped');
    if (res?.status === 401) return router.replace('/login');
    say(
      res?.status === 409
        ? conflictText(res, move.number)
        : res?.status === 422
          ? fill(b.refused.notAllowed, { number: String(move.number) })
          : fill(b.refused.failed, { number: String(move.number) }),
    );
  };

  /** A move that needs words: the order page's dialog, with the order as it is now. */
  const ask = async (move: Move, kind: DialogState['kind']) => {
    const res = await browserApi.orders.get({ params: { number: move.number } }).catch(() => null);
    if (res?.status === 401) return router.replace('/login');
    if (res?.status !== 200) {
      settle(move, 'dropped');
      return say(fill(b.refused.failed, { number: String(move.number) }));
    }
    const page = res.body;
    if (page.order.status !== move.from) {
      settle(move, 'dropped');
      return say(
        fill(b.refused.conflict, {
          number: String(move.number),
          status: statusName(page.order.status),
        }),
      );
    }
    const receipt = move.from === 'receipt_review' ? waitingReceipt(page) : null;
    if (kind === 'reject' && !receipt) {
      settle(move, 'dropped');
      return say(fill(b.refused.notAllowed, { number: String(move.number) }));
    }
    setDialog({ kind, move, page, receiptId: receipt?.id ?? null, key: Date.now() });
  };

  /** Picks the move for `card` to `to` (only what staff may do), shows it, and makes it. */
  const begin = (card: AdminBoardCardDto, to: OrderStatus) => {
    const row = staffMove(card.status, to);
    const kind = row ? moveKind(row.action) : null;
    if (!row || !kind) return;
    const move: Move = {
      number: card.number,
      from: card.status,
      to,
      since: serverNow(),
      state: kind === 'step' ? 'saving' : 'pending',
    };
    epoch.current += 1;
    setMoves((all) => [...all.filter((m) => m.number !== card.number), move]);
    if (kind === 'step') void step(move, row.action as 'accept' | 'start_assembly' | 'deliver');
    else void ask(move, kind);
  };

  /** What a dialog's request answered: done, or what to show in it, or the card goes back. */
  const answer = (res: MoveResponse | null, move: Move, reason?: string): Failure | null => {
    if (!res) return { text: t.errors.generic };
    switch (res.status) {
      case 200:
        setDialog(null);
        settle(move, 'done');
        return null;
      case 409:
        if (res.body.code === 'try_again') return { text: o.tryAgain };
        setDialog(null);
        settle(move, 'dropped');
        say(conflictText(res, move.number));
        return null;
      case 422:
        return refusalFailure(res.body, t, language, reason);
      case 401:
        router.replace('/login');
        return null;
      default:
        return { text: t.errors.generic };
    }
  };

  /** The dialog closed without its move: the card goes home. */
  const dismiss = () => {
    if (!dialog) return;
    const { move } = dialog;
    setDialog(null);
    settle(move, 'dropped');
    setSaid(
      fill(b.announce.stayed, { number: String(move.number), status: statusName(move.from) }),
    );
  };

  // ---- carrying

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
      coordinateGetter: columnHop,
    }),
  );
  const cardOf = (data: unknown) =>
    (data as { card?: AdminBoardCardDto } | undefined)?.card ?? null;
  const statusOf = (data: unknown) =>
    (data as { status?: OrderStatus } | undefined)?.status ?? null;

  const carryOf = (status: OrderStatus): Carry | null => {
    if (!carried) return null;
    if (status === carried.status) return { role: 'home' };
    const row = staffMove(carried.status, status);
    if (!row) return { role: 'closed' };
    const kind = moveKind(row.action);
    return {
      role: 'target',
      action: actionLabel(row.action, t) + (kind && kind !== 'step' ? '…' : ''),
      over: overStatus === status,
    };
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const card = cardOf(active.data.current);
      return card
        ? fill(b.announce.picked, { number: String(card.number), status: statusName(card.status) })
        : undefined;
    },
    onDragOver: ({ active, over }) => {
      const card = cardOf(active.data.current);
      const to = statusOf(over?.data.current);
      if (!card || !to || to === card.status) return undefined;
      const row = staffMove(card.status, to);
      return row
        ? fill(b.announce.over, { status: statusName(to), action: actionLabel(row.action, t) })
        : fill(b.announce.overNot, { status: statusName(to) });
    },
    onDragEnd: ({ active, over }) => {
      const card = cardOf(active.data.current);
      const to = statusOf(over?.data.current);
      if (!card) return undefined;
      const row = to && to !== card.status ? staffMove(card.status, to) : undefined;
      return row
        ? fill(b.announce.dropped, {
            number: String(card.number),
            action: actionLabel(row.action, t),
          })
        : fill(b.announce.stayed, { number: String(card.number), status: statusName(card.status) });
    },
    onDragCancel: ({ active }) => {
      const card = cardOf(active.data.current);
      return card
        ? fill(b.announce.stayed, { number: String(card.number), status: statusName(card.status) })
        : undefined;
    },
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const card = cardOf(active.data.current);
    const to = statusOf(over?.data.current);
    setCarried(null);
    setOverStatus(null);
    if (card && to && to !== card.status && staffMove(card.status, to)) {
      setLanding(true);
      begin(card, to);
    }
  };

  // ---- what is shown

  const columns = board ? withMoves(board, moves) : null;
  const column = (s: OrderStatus) => columns?.find((c) => c.status === s);
  const moveOf = (number: number) => moves.find((m) => m.number === number);
  const everything = columns?.every((c) => c.count === 0) ?? false;

  const targetsOf = (card: AdminBoardCardDto): Target[] =>
    staffTargets(card.status).map((status) => {
      const row = staffMove(card.status, status)!;
      return { status, asks: moveKind(row.action) !== 'step' };
    });

  const jump = (s: OrderStatus) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = () =>
      columnEls.current.get(s)?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        inline: 'start',
        block: 'nearest',
      });
    if ((CLOSED as readonly OrderStatus[]).includes(s) && !expanded.includes(s)) {
      setExpanded((e) => [...e, s]);
      requestAnimationFrame(go);
    } else go();
  };
  const toggle = (s: OrderStatus) => {
    if (expanded.includes(s)) setExpanded((e) => e.filter((x) => x !== s));
    else {
      setExpanded((e) => [...e, s]);
      requestAnimationFrame(() =>
        columnEls.current
          .get(s)
          ?.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' }),
      );
    }
  };

  const { ref: frame, height } = useFillHeight();
  const listFor = (s: OrderStatus) => listHref('/orders', { view: 'list', ...filters, status: s });
  const updated = board ? utcToTashkent(new Date(board.at)) : null;
  const pad = (n: number) => String(n).padStart(2, '0');

  const renderColumn = (s: OrderStatus, onCollapse?: () => void) => {
    const c = column(s);
    if (!c || !board) return null;
    return (
      <BoardColumn
        key={s}
        column={c}
        carry={carryOf(s)}
        language={language}
        t={t}
        listHref={listFor(s)}
        onCollapse={onCollapse}
        columnRef={(el) => {
          if (el) columnEls.current.set(s, el);
          else columnEls.current.delete(s);
        }}
        empty={
          everything && !filtered && s === 'awaiting_payment' ? (
            <li
              className="grid gap-0.5 rounded-card border-[1.5px] border-dashed border-border-strong px-3 py-4"
              data-empty-slot
            >
              <span className="text-[13.5px] font-semibold">{b.empty}</span>
              <span className="text-small text-muted-foreground">{b.emptySlot}</span>
            </li>
          ) : undefined
        }
      >
        {c.cards.map((card) => {
          const move = moveOf(card.number);
          return (
            <BoardCard
              key={card.number}
              card={card}
              at={board.at}
              t={t}
              language={language}
              targets={targetsOf(card)}
              onMove={(to) => begin(card, to)}
              waiting={move !== undefined && move.state !== 'done'}
              arrived={arrived.has(card.number)}
              locked={dialog !== null}
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
              void fetchBoard();
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
      style={{ height: height ?? MIN_HEIGHT }}
      data-board
      aria-busy={board ? undefined : true}
    >
      <div className="mb-2.5 flex min-h-8 items-center justify-between gap-4">
        <nav
          aria-label={b.funnel}
          className="-mx-1 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
        >
          <ol className="flex items-center whitespace-nowrap">
            {BOARD_STATUSES.map((s, i) => {
              const c = column(s);
              const closedStart = s === 'cancelled';
              return (
                <li key={s} className="flex items-center">
                  {i > 0 &&
                    (closedStart ? (
                      <span aria-hidden className="mx-2 h-4 w-px bg-border-strong" />
                    ) : (
                      <ChevronRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-faint"
                        strokeWidth={1.5}
                      />
                    ))}
                  <button
                    type="button"
                    onClick={() => jump(s)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-button px-1.5 text-[13px] transition-[background-color,color] duration-150 ease-out hover:bg-field',
                      c && c.count > 0 ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {statusName(s)}
                    <span className="font-semibold tabular-nums">
                      {c ? <Settle value={String(c.count)} /> : '·'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        {updated && (
          <p className="shrink-0 text-small text-muted-foreground tabular-nums max-sm:hidden">
            {fill(b.updated, { time: `${pad(updated.hour)}:${pad(updated.minute)}` })}
          </p>
        )}
      </div>
      {filtered && everything && (
        <p className="mb-2.5 text-[13.5px] font-semibold" role="status">
          {o.emptyFiltered}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collide}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={{ threshold: { x: 0.12, y: 0.18 } }}
        accessibility={{ announcements, screenReaderInstructions: { draggable: b.instructions } }}
        onDragStart={({ active }) => {
          setLanding(false);
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
          className="board-scroller -mx-4 flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 sm:mx-0 sm:px-0"
          data-carrying={carried ? '' : undefined}
        >
          {columns
            ? OPEN.map((s) => renderColumn(s))
            : OPEN.map((s) => <SkeletonColumn key={s} name={statusName(s)} />)}
          {columns &&
            CLOSED.filter((s) => expanded.includes(s)).map((s) => renderColumn(s, () => toggle(s)))}
          <div className="flex shrink-0 gap-2 sm:sticky sm:right-0 sm:z-10 sm:bg-background sm:pl-2">
            {CLOSED.map((s) => {
              const c = column(s);
              return c ? (
                <BoardRail
                  key={s}
                  column={c}
                  carry={carryOf(s)}
                  expanded={expanded.includes(s)}
                  onToggle={() => toggle(s)}
                  language={language}
                  t={t}
                />
              ) : (
                <div key={s} className="skeleton h-full w-12 rounded-card" />
              );
            })}
          </div>
        </div>
        <DragOverlay
          dropAnimation={landing ? LAND : RETURN}
          transition={() => undefined}
          zIndex={60}
        >
          {carried && board ? (
            <div className="motion-lift cursor-grabbing rounded-card bg-card px-3 pt-2 pb-3 shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
              <CardBody card={carried} at={board.at} t={t} language={language} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {board && (
        <p className="mt-2 text-small text-muted-foreground">
          {fill(plural(language, board.recentDays, b.recent), { n: String(board.recentDays) })}
          {' · '}
          <Link
            href={listHref('/orders', { view: 'list', ...filters })}
            className="font-medium text-foreground underline decoration-border-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current"
          >
            {b.allInList}
          </Link>
        </p>
      )}

      {/* one polite region for what moved; refusals also show in the toast below */}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-5 z-[65] flex justify-center px-4 lg:left-[280px]"
      >
        {toast && (
          <div
            key={toast.key}
            role="status"
            className="motion-toast pointer-events-auto flex max-w-[min(520px,100%)] items-start gap-3 rounded-card bg-graphite py-3 pr-2 pl-4 text-[13.5px] leading-snug text-milk"
            data-board-toast
          >
            <p className="min-w-0 py-1 text-pretty [overflow-wrap:anywhere]">{toast.text}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label={b.dismiss}
              className="grid size-8 shrink-0 place-items-center rounded-button text-milk/70 transition-[background-color,color] duration-150 hover:bg-milk/10 hover:text-milk"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {dialog?.kind === 'hand' && (
        <HandToBtsDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && dismiss()}
          page={dialog.page}
          t={t}
          onSubmit={async ({ trackingNumber }) =>
            answer(
              await browserApi.orders
                .fulfil({
                  params: { number: dialog.move.number },
                  body: { action: 'hand_to_bts', expectedStatus: dialog.move.from, trackingNumber },
                })
                .catch(() => null),
              dialog.move,
            )
          }
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && dismiss()}
          page={dialog.page}
          t={t}
          onSubmit={async (body) =>
            answer(
              await browserApi.orders
                .cancel({
                  params: { number: dialog.move.number },
                  body: { ...body, expectedStatus: dialog.move.from },
                })
                .catch(() => null),
              dialog.move,
            )
          }
        />
      )}
      {dialog?.kind === 'confirm' && (
        <ConfirmPaymentDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && dismiss()}
          page={dialog.page}
          receiptId={dialog.receiptId}
          t={t}
          language={language}
          onSubmit={async (body) =>
            answer(
              await browserApi.orders
                .confirmPayment({ params: { number: dialog.move.number }, body })
                .catch(() => null),
              dialog.move,
              body.reason,
            )
          }
        />
      )}
      {dialog?.kind === 'reject' && dialog.receiptId !== null && (
        <RejectDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && dismiss()}
          page={dialog.page}
          receiptId={dialog.receiptId}
          t={t}
          onSubmit={async (body) =>
            answer(
              await browserApi.orders
                .rejectReceipt({ params: { number: dialog.move.number }, body })
                .catch(() => null),
              dialog.move,
            )
          }
        />
      )}
      {dialog?.kind === 'return' && (
        <ReturnDialog
          key={dialog.key}
          open
          onOpenChange={(v) => !v && dismiss()}
          page={dialog.page}
          t={t}
          language={language}
          onSubmit={async (body) =>
            answer(
              await browserApi.orders
                .return({
                  params: { number: dialog.move.number },
                  body: { ...body, expectedStatus: dialog.move.from },
                })
                .catch(() => null),
              dialog.move,
            )
          }
        />
      )}
    </div>
  );
}

/** A column before the first board: its head is known, its cards breathe in Milk Field. */
function SkeletonColumn({ name }: { name: string }) {
  return (
    <section className="flex h-full w-[248px] shrink-0 snap-start flex-col rounded-card bg-field max-sm:w-[calc(100vw-88px)]">
      <header className="px-3 pt-2.5 pb-2">
        <div className="flex min-h-7 items-center">
          <h2 className="truncate text-[13.5px] leading-snug font-semibold text-muted-foreground">
            {name}
          </h2>
        </div>
        <p className="h-[18px]" />
      </header>
      <div className="grid gap-2 px-2">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-2 rounded-card bg-card px-3 py-3">
            <div className="skeleton h-3.5 w-16" />
            <div className="skeleton h-3.5 w-32" />
            <div className="skeleton h-3 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}

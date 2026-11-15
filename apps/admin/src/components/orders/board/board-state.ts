import {
  isHistoryStatus,
  type AdminBoardCardDto,
  type AdminBoardColumnDto,
  type AdminOrdersBoardDto,
  type FulfilAction,
  type OrderAction,
  type OrderStatus,
} from '@lummi/contracts';
import type { AdminMessages } from '@/lib/i18n';

/*
 * The orders board's own state (#52), apart from React: the server's board with the moves made
 * on it since, and how each move is made. The server stays the authority: a move is shown at
 * once (optimistic) and dropped again when it refuses or once a fresh board shows it.
 */

/**
 * A move shown before the server's board shows it: `pending` while its dialog asks for words,
 * `saving` while the request runs, `done` once the server took it (until the next board).
 */
export type Move = {
  number: number;
  from: OrderStatus;
  to: OrderStatus;
  /** When the board shows it entered `to` (the moment it was dropped). */
  since: string;
  state: 'pending' | 'saving' | 'done';
};

/**
 * How a move is made: `step` is one fulfilment press with nothing to ask; the others open the
 * order page's dialog for what they need (a tracking number, a reason, the credit, the lines).
 */
export type MoveKind = 'step' | 'hand' | 'cancel' | 'return' | 'confirm' | 'reject';

/** The fulfilment presses the board sends at once (the order page's own step button). */
export type StepAction = Extract<FulfilAction, 'accept' | 'start_assembly' | 'deliver'>;

/**
 * Every move staff make on the board, in one table: how it is made and its words, as the order
 * page's buttons name it. The board offers no other.
 */
const STAFF_MOVES: Partial<
  Record<OrderAction, { kind: MoveKind; label: (o: AdminMessages['orders']) => string }>
> = {
  accept: { kind: 'step', label: (o) => o.step.accept },
  start_assembly: { kind: 'step', label: (o) => o.step.start_assembly },
  deliver: { kind: 'step', label: (o) => o.step.deliver },
  hand_to_bts: { kind: 'hand', label: (o) => o.step.hand_to_bts },
  cancel: { kind: 'cancel', label: (o) => o.step.cancel },
  return: { kind: 'return', label: (o) => o.ret.action },
  confirm_payment: { kind: 'confirm', label: (o) => o.detail.confirm },
  reject_receipt: { kind: 'reject', label: (o) => o.detail.reject },
};

export const moveKind = (action: OrderAction): MoveKind | null => STAFF_MOVES[action]?.kind ?? null;

export const moveLabel = (action: OrderAction, t: AdminMessages): string =>
  STAFF_MOVES[action]?.label(t.orders) ?? '';

export const isStep = (action: OrderAction): action is StepAction =>
  STAFF_MOVES[action]?.kind === 'step';

/**
 * The order of cards in a column: a work column puts the longest wait first (oldest in its
 * status), a history column the newest; equal moments by number the same way. The server sorts
 * alike; this places a card the board moved itself.
 */
export function columnOrder(status: OrderStatus) {
  const sign = isHistoryStatus(status) ? -1 : 1;
  return (a: AdminBoardCardDto, b: AdminBoardCardDto) => {
    const at = Date.parse(a.statusSince) - Date.parse(b.statusSince);
    return sign * (at !== 0 ? at : a.number - b.number);
  };
}

/**
 * The columns as the board shows them: the server's, with each move not yet in them applied.
 * A moved card leaves its column and takes its place in the new one, and the counts follow. The
 * money stays as the server last added it up (the server owns money): the next board, right after
 * the move, brings the new sums. A move the server's board already shows changes nothing.
 */
export function withMoves(board: AdminOrdersBoardDto, moves: Move[]): AdminBoardColumnDto[] {
  const columns = board.columns.map((c) => ({ ...c, cards: [...c.cards] }));
  for (const move of moves) {
    const source = columns.find((c) => c.cards.some((x) => x.number === move.number));
    const target = columns.find((c) => c.status === move.to);
    if (!source || !target || source === target) continue;
    const card = source.cards.find((x) => x.number === move.number)!;
    source.cards = source.cards.filter((x) => x.number !== move.number);
    source.count = Math.max(0, source.count - 1);
    target.cards = [...target.cards, { ...card, status: move.to, statusSince: move.since }].sort(
      columnOrder(move.to),
    );
    target.count += 1;
  }
  return columns;
}

/**
 * Which cards a fresh board brings into view: those not in the shown column before (a new order,
 * or another manager's move). Nothing on the first board: only a change moves (DESIGN.md).
 */
export function arrivals(before: AdminBoardColumnDto[] | null, after: AdminBoardColumnDto[]) {
  const was = new Map<number, OrderStatus>();
  for (const c of before ?? []) for (const card of c.cards) was.set(card.number, c.status);
  const fresh = new Set<number>();
  if (!before) return fresh;
  for (const c of after)
    for (const card of c.cards) if (was.get(card.number) !== c.status) fresh.add(card.number);
  return fresh;
}

/** Whole seconds from `since` to the board's `at`, never below 0. */
export const secondsIn = (since: string, at: string) =>
  Math.max(0, Math.floor((Date.parse(at) - Date.parse(since)) / 1000));

/**
 * From 640 px: columns at least this wide (the card's narrow layout holds RU and UZ at it), 8 px
 * apart, and the next one peeking in by 24 px. At 1280 five funnel columns fit beside the rails.
 */
const MIN_COLUMN = 156;
const MAX_COLUMN = 300;
const GAP = 8;
const PEEK = 24;

/**
 * From 640 px the board sizes its columns to the room it has, so a column never rests half
 * hidden at either end: all of them share the width when they fit (at most `MAX_COLUMN` each);
 * otherwise as many whole columns as fit and the next one peeking in, as the shop's card rows do.
 * `endPad` is the room after the last column that lets the scroll end on a column's start too, so
 * the board snaps whole columns at both ends. On phones a column is the screen less 88 px instead.
 */
export function columnLayout(room: number, count: number): { width: number; endPad: number } {
  if (count * MIN_COLUMN + (count - 1) * GAP <= room)
    return {
      width: Math.min(MAX_COLUMN, Math.floor((room - (count - 1) * GAP) / count)),
      endPad: 0,
    };
  const whole = Math.max(1, Math.floor((room - PEEK) / (MIN_COLUMN + GAP)));
  const width = Math.floor((room - PEEK) / whole - GAP);
  return { width, endPad: room - whole * (width + GAP) + GAP };
}

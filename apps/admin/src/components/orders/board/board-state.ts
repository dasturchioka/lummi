import {
  isHistoryStatus,
  type AdminBoardCardDto,
  type AdminBoardColumnDto,
  type AdminOrdersBoardDto,
  type OrderAction,
  type OrderStatus,
} from '@lummi/contracts';

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

export function moveKind(action: OrderAction): MoveKind | null {
  switch (action) {
    case 'accept':
    case 'start_assembly':
    case 'deliver':
      return 'step';
    case 'hand_to_bts':
      return 'hand';
    case 'cancel':
      return 'cancel';
    case 'return':
      return 'return';
    case 'confirm_payment':
      return 'confirm';
    case 'reject_receipt':
      return 'reject';
    default:
      return null;
  }
}

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

/** The card with this number, wherever the server's board has it. */
export function findCard(board: AdminOrdersBoardDto, number: number): AdminBoardCardDto | null {
  for (const column of board.columns) {
    const card = column.cards.find((c) => c.number === number);
    if (card) return card;
  }
  return null;
}

/**
 * The columns as the board shows them: the server's, with each move not yet in them applied.
 * A moved card leaves its column (count and money too) and takes its place in the new one. A move
 * the server's board already shows (the card is in `to`) changes nothing.
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
    source.sum = Math.max(0, source.sum - card.total);
    target.cards = [...target.cards, { ...card, status: move.to, statusSince: move.since }].sort(
      columnOrder(move.to),
    );
    target.count += 1;
    target.sum += card.total;
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

/** From 640 px: columns are at least this wide, 8 px apart, and the next one peeks in by 40 px. */
const MIN_COLUMN = 248;
const MAX_COLUMN = 320;
const GAP = 8;
const PEEK = 40;

/**
 * From 640 px the board sizes its columns to the room it has, so a column never rests as a sliver
 * at the edge: all of them share the width when they fit (at most `MAX_COLUMN` each), otherwise
 * as many whole columns as fit and the next one peeking in by `PEEK`, as the shop's card rows do.
 * Null on phones, where a column is the screen less 88 px and the board snaps column by column.
 */
export function columnWidth(room: number, count: number): number {
  if (count * MIN_COLUMN + (count - 1) * GAP <= room)
    return Math.min(MAX_COLUMN, Math.floor((room - (count - 1) * GAP) / count));
  const whole = Math.max(1, Math.floor((room - PEEK) / (MIN_COLUMN + GAP)));
  return Math.floor((room - PEEK) / whole - GAP);
}

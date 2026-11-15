import { BOARD_STATUSES, type AdminBoardCardDto, type AdminOrdersBoardDto } from '@lummi/contracts';
import { describe, expect, it } from 'vitest';
import { arrivals, moveKind, secondsIn, withMoves, type Move } from './board-state';

const card = (
  number: number,
  status: AdminBoardCardDto['status'],
  since: string,
  total = 100_000,
) =>
  ({
    number,
    status,
    payment: 'paid',
    refundOwed: false,
    statusSince: since,
    total,
    itemCount: 1,
    customer: { name: 'Ali' },
    city: 'Самарканд',
    region: { ru: 'Самаркандская область', uz: 'Samarqand viloyati' },
    isGift: false,
  }) satisfies AdminBoardCardDto;

/** A board of the given cards, every column counted from them. */
function boardOf(cards: AdminBoardCardDto[]): AdminOrdersBoardDto {
  return {
    at: '2026-11-16T04:00:00.000Z',
    recentDays: 14,
    limit: 50,
    columns: BOARD_STATUSES.map((status) => {
      const own = cards.filter((c) => c.status === status);
      return { status, count: own.length, sum: own.reduce((n, c) => n + c.total, 0), cards: own };
    }),
  };
}

const at = (h: number) => `2026-11-16T0${h}:00:00.000Z`;
const column = (cols: ReturnType<typeof withMoves>, status: string) =>
  cols.find((c) => c.status === status)!;

describe('moves on the board', () => {
  const board = boardOf([
    card(1001, 'accepted', at(1), 200_000),
    card(1002, 'assembling', at(1)),
    card(1003, 'assembling', at(2)),
    card(1004, 'delivered', at(1)),
  ]);

  it('a moved card leaves its column, counted and summed, and goes last in a work column', () => {
    const move: Move = {
      number: 1001,
      from: 'accepted',
      to: 'assembling',
      since: at(3),
      state: 'saving',
    };
    const cols = withMoves(board, [move]);
    expect(column(cols, 'accepted')).toMatchObject({ count: 0, sum: 0, cards: [] });
    const assembling = column(cols, 'assembling');
    expect(assembling.cards.map((c) => c.number)).toEqual([1002, 1003, 1001]);
    expect(assembling).toMatchObject({ count: 3, sum: 400_000 });
    expect(assembling.cards[2]).toMatchObject({ status: 'assembling', statusSince: at(3) });
  });

  it('first in a history column, which puts the newest first', () => {
    const move: Move = {
      number: 1003,
      from: 'assembling',
      to: 'delivered',
      since: at(5),
      state: 'done',
    };
    expect(column(withMoves(board, [move]), 'delivered').cards.map((c) => c.number)).toEqual([
      1003, 1004,
    ]);
  });

  it('changes nothing once the server’s board shows it, and leaves the server’s board as it was', () => {
    const move: Move = {
      number: 1004,
      from: 'handed_to_bts',
      to: 'delivered',
      since: at(5),
      state: 'done',
    };
    expect(column(withMoves(board, [move]), 'delivered').count).toBe(1);
    withMoves(board, [
      { number: 1002, from: 'assembling', to: 'cancelled', since: at(3), state: 'pending' },
    ]);
    expect(board.columns.find((c) => c.status === 'assembling')!.cards).toHaveLength(2);
  });

  it('each move is a press or the dialog that asks for what it needs', () => {
    expect(moveKind('accept')).toBe('step');
    expect(moveKind('deliver')).toBe('step');
    expect(moveKind('hand_to_bts')).toBe('hand');
    expect(moveKind('confirm_payment')).toBe('confirm');
    expect(moveKind('reject_receipt')).toBe('reject');
    expect(moveKind('return')).toBe('return');
    expect(moveKind('submit_receipt')).toBeNull();
  });
});

describe('a fresh board', () => {
  it('brings into view only what is new in a column, and nothing on the first board', () => {
    const before = boardOf([card(1, 'accepted', at(1)), card(2, 'assembling', at(1))]).columns;
    const after = boardOf([
      card(1, 'assembling', at(2)),
      card(2, 'assembling', at(1)),
      card(3, 'awaiting_payment', at(3)),
    ]).columns;
    expect([...arrivals(before, after)].sort()).toEqual([1, 3]);
    expect(arrivals(null, after).size).toBe(0);
  });

  it('measures the time in a status from the server’s now', () => {
    expect(secondsIn(at(1), at(3))).toBe(7200);
    expect(secondsIn(at(3), at(1))).toBe(0);
  });
});

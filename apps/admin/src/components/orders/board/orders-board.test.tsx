// @vitest-environment jsdom
import {
  BOARD_STATUSES,
  type AdminBoardCardDto,
  type AdminOrdersBoardDto,
  type OrderStatus,
} from '@lummi/contracts';
import { adminMessages } from '@lummi/i18n/admin';
import { ordersMessages } from '@lummi/i18n/orders';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The orders board (#52): a move shows at once and the server decides. A step the server refuses
 * (409, 422) puts the card back with one sentence; a board that arrives while a move is saved is
 * not applied over it.
 */

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));
const board = vi.fn();
const fulfil = vi.fn();
vi.mock('@/lib/api', () => ({
  browserApi: {
    orders: { board: (a: unknown) => board(a), fulfil: (a: unknown) => fulfil(a) },
  },
}));

const { OrdersBoard } = await import('./orders-board');

const t = adminMessages.ru.admin;
const status = ordersMessages.ru.orders.status;

const card = (number: number, s: OrderStatus): AdminBoardCardDto => ({
  number,
  status: s,
  payment: 'paid',
  refundOwed: false,
  statusSince: '2026-11-16T04:00:00.000Z',
  total: 244_000,
  itemCount: 1,
  customer: { name: `Покупатель ${number}` },
  city: 'Самарканд',
  region: { ru: 'Самаркандская область', uz: 'Samarqand viloyati' },
  isGift: false,
});
const boardOf = (cards: AdminBoardCardDto[]): AdminOrdersBoardDto => ({
  at: '2026-11-16T05:00:00.000Z',
  recentDays: 14,
  limit: 50,
  columns: BOARD_STATUSES.map((s) => {
    const own = cards.filter((c) => c.status === s);
    return { status: s, count: own.length, sum: own.length * 244_000, cards: own };
  }),
});
const ok = (cards: AdminBoardCardDto[]) => ({ status: 200, body: boardOf(cards) });

const tick = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const columnOf = (number: number) =>
  document
    .querySelector(`[data-order="${number}"]`)
    ?.closest('[data-column]')
    ?.getAttribute('data-column');

/** «Переместить в…» on the card, then the status: the non-drag path. */
async function moveVia(number: number, to: OrderStatus) {
  const trigger = document.querySelector(`[data-move-menu="${number}"]`) as HTMLElement;
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await tick();
  fireEvent.click(within(screen.getByRole('menu')).getByText(status[to]));
  await tick();
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
beforeEach(() => {
  vi.useFakeTimers();
  board.mockReset();
  fulfil.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OrdersBoard', () => {
  it('a step moves the card at once with the status the board saw; the server takes it', async () => {
    board.mockResolvedValue(ok([card(1001, 'payment_confirmed')]));
    let answer: (v: unknown) => void = () => undefined;
    fulfil.mockReturnValue(new Promise((r) => (answer = r)));
    render(<OrdersBoard t={t} language="ru" filters={{}} />);
    await tick();
    expect(columnOf(1001)).toBe('payment_confirmed');

    await moveVia(1001, 'accepted');
    expect(columnOf(1001)).toBe('accepted');
    expect(fulfil).toHaveBeenCalledWith({
      params: { number: 1001 },
      body: { action: 'accept', expectedStatus: 'payment_confirmed' },
    });
    // the server took it, and its next board shows it there
    board.mockResolvedValue(ok([card(1001, 'accepted')]));
    answer({ status: 200, body: {} });
    await tick();
    await tick();
    expect(board).toHaveBeenCalledTimes(2);
    expect(columnOf(1001)).toBe('accepted');
  });

  it('offers only the moves staff may make', async () => {
    board.mockResolvedValue(ok([card(1002, 'assembling')]));
    render(<OrdersBoard t={t} language="ru" filters={{}} />);
    await tick();
    const trigger = document.querySelector('[data-move-menu="1002"]') as HTMLElement;
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await tick();
    const items = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((i) => i.textContent);
    expect(items).toEqual([`${status.handed_to_bts}…`, `${status.cancelled}…`]);
  });

  it('a refusal puts the card back and says why', async () => {
    board.mockResolvedValue(ok([card(1003, 'payment_confirmed')]));
    fulfil.mockResolvedValue({
      status: 409,
      body: { code: 'status_changed', order: { order: { status: 'cancelled' } } },
    });
    render(<OrdersBoard t={t} language="ru" filters={{}} />);
    await tick();
    await moveVia(1003, 'accepted');
    expect(columnOf(1003)).toBe('payment_confirmed');
    expect(document.querySelector('[data-board-toast]')?.textContent).toContain(
      `Заказ № 1003 не перемещён: он уже «${status.cancelled}»`,
    );
  });

  it('a board that arrives while a move is saved is not shown over it', async () => {
    board.mockResolvedValueOnce(ok([card(1004, 'accepted')]));
    let answer: (v: unknown) => void = () => undefined;
    fulfil.mockReturnValue(new Promise((r) => (answer = r)));
    render(<OrdersBoard t={t} language="ru" filters={{}} />);
    await tick();
    await moveVia(1004, 'assembling');
    // a poll while the move runs: skipped; the older board never pulls the card back
    board.mockResolvedValue(ok([card(1004, 'accepted')]));
    await tick(10_000);
    expect(columnOf(1004)).toBe('assembling');
    answer({ status: 200, body: {} });
    board.mockResolvedValue(ok([{ ...card(1004, 'assembling') }]));
    await tick();
    await tick();
    expect(columnOf(1004)).toBe('assembling');
  });
});

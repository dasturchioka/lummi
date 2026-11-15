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
 * (409, 422) puts the card back with one sentence; a move that needs words opens the order page's
 * dialog and sends its request, and closing the dialog puts the card back; the keyboard carries a
 * card column to column; a board that arrives while a move is saved is not applied over it.
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
const get = vi.fn();
vi.mock('@/lib/api', () => ({
  browserApi: {
    orders: {
      board: (a: unknown) => board(a),
      fulfil: (a: unknown) => fulfil(a),
      get: (a: unknown) => get(a),
    },
  },
}));

const { OrdersBoard } = await import('./orders-board');
const { dropAnimation } = await import('./board-dnd');

/** The order page as the dialogs read it: enough for the tracking and cancel dialogs. */
const page = (number: number, s: OrderStatus) => ({
  order: { number, status: s },
  payment: 'paid',
  receipts: [],
  customer: { language: 'ru' },
  limits: { rejectNoteMax: 500, linkReasonMin: 10, linkReasonMax: 500 },
});

/**
 * jsdom lays nothing out: each column (and rail) gets a 280 px slot in the board's order, each
 * card a place inside its column, so the keyboard can carry a card from one to the next.
 */
function layOut() {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    // the carried copy (a portal) starts where the first card sits
    const carried = this.closest('.motion-lift') ?? this.querySelector('.motion-lift');
    const self = carried ? document.querySelector('[data-order]') : this;
    const home = self?.closest('[data-column], [data-rail]');
    const status = home?.getAttribute('data-column') ?? home?.getAttribute('data-rail');
    const i = status ? BOARD_STATUSES.indexOf(status as OrderStatus) : -1;
    if (i < 0) return rect(0, 0, 0, 0);
    return self === home ? rect(i * 300, 0, 280, 600) : rect(i * 300 + 10, 60, 260, 120);
  });
}

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
  shopHasOrders: true,
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
  // a move that opens a dialog ends in «…»
  fireEvent.click(
    within(screen.getByRole('menu')).getByText((text) => text.replace(/…$/, '') === status[to]),
  );
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
  layOut();
  vi.useFakeTimers();
  board.mockReset();
  fulfil.mockReset();
  get.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('a move that needs words opens the order page’s dialog and sends the order page’s request', async () => {
    board.mockResolvedValue(ok([card(1005, 'assembling')]));
    get.mockResolvedValue({ status: 200, body: page(1005, 'assembling') });
    fulfil.mockReturnValue(new Promise(() => undefined));
    render(<OrdersBoard t={t} language="ru" filters={{}} />);
    await tick();
    await moveVia(1005, 'handed_to_bts');
    // shown at once in the new column, waiting for its words
    expect(columnOf(1005)).toBe('handed_to_bts');
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'BTS 1005 0042' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t.orders.step.hand_to_bts }));
    await tick();
    expect(fulfil).toHaveBeenCalledWith({
      params: { number: 1005 },
      body: {
        action: 'hand_to_bts',
        expectedStatus: 'assembling',
        trackingNumber: 'BTS 1005 0042',
      },
    });
  });

  it('closing the dialog puts the card back where it was', async () => {
    board.mockResolvedValue(ok([card(1006, 'accepted')]));
    get.mockResolvedValue({ status: 200, body: page(1006, 'accepted') });
    render(<OrdersBoard t={t} language="ru" filters={{}} />);
    await tick();
    await moveVia(1006, 'cancelled');
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: t.orders.keep }),
    );
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(columnOf(1006)).toBe('accepted');
    expect(fulfil).not.toHaveBeenCalled();
  });

  it('the keyboard carries a card: Space picks it up, the arrows go column to column, Space drops', async () => {
    board.mockResolvedValue(ok([card(1007, 'payment_confirmed')]));
    fulfil.mockReturnValue(new Promise(() => undefined));
    render(<OrdersBoard t={t} language="ru" filters={{}} />);
    await tick();
    const link = document.querySelector('[data-order="1007"] a') as HTMLElement;
    link.focus();
    fireEvent.keyDown(link, { key: ' ', code: 'Space' });
    await tick(50);
    // «Принят» is the next column it may go to; «Отменён» is a rail further on
    fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight' });
    await tick(50);
    expect(document.querySelector('[data-over]')?.getAttribute('data-column')).toBe('accepted');
    fireEvent.keyDown(document, { key: ' ', code: 'Space' });
    await tick(300);
    expect(fulfil).toHaveBeenCalledWith({
      params: { number: 1007 },
      body: { action: 'accept', expectedStatus: 'payment_confirmed' },
    });
    expect(columnOf(1007)).toBe('accepted');
  });
});

describe('the drop with reduced motion', () => {
  const frames = (landed: boolean, reduced: boolean) => {
    const animation = dropAnimation(landed, reduced);
    if (typeof animation === 'function' || !animation.keyframes) return null;
    const transform = { x: 120, y: 40, scaleX: 1, scaleY: 1 };
    return animation.keyframes({
      transform: { initial: transform, final: { ...transform, x: 0, y: 0 } },
    } as never);
  };

  it('only fades where it was let go, landed or not: nothing travels or scales', () => {
    for (const landed of [true, false]) {
      const [from, to] = frames(landed, true)!;
      expect(from!.transform).toBe(to!.transform);
      expect(String(to!.transform)).not.toContain('scale');
      expect([from!.opacity, to!.opacity]).toEqual([1, 0]);
    }
  });

  it('without it, a card that cannot land travels home', () => {
    expect(frames(false, false)).toBeNull();
    expect(dropAnimation(false, false)).toMatchObject({ duration: 220 });
  });
});

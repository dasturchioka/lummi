import type { OrderDto } from '@lummi/contracts';
import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openManagerChat = vi.fn();
let managerUsername: string | undefined = '@lummi_shop';
vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language: 'ru',
    theme: 'light',
    t: { ...sharedMessages.ru, ...miniappMessages.ru },
    customer: managerUsername ? { config: { managerUsername } } : undefined,
  }),
}));
vi.mock('../lib/telegram', () => ({ openManagerChat: (u: string) => openManagerChat(u) }));
const cancelOrder = vi.fn();
vi.mock('../lib/api', () => ({
  api: { orders: { cancel: (req: unknown) => cancelOrder(req), get: vi.fn() } },
  unwrap: vi.fn(),
  session: {},
}));

import { OrderView } from './Order';

function renderView(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const order = (over: Partial<OrderDto> = {}): OrderDto => ({
  number: 1001,
  status: 'awaiting_payment',
  createdAt: '2026-11-09T10:00:00.000Z',
  reserveUntil: '2026-11-09T22:00:00.000Z',
  recipient: { name: 'Dilnoza Karimova', phone: '+998901234567' },
  delivery: {
    region: { ru: 'Самаркандская область', uz: 'Samarqand viloyati' },
    point: {
      code: '57',
      name: 'FIRDAVSIY',
      city: 'Самарканд',
      address: 'ул. Гагарина, 155',
      landmark: null,
      hours: null,
    },
    typed: null,
  },
  comment: null,
  gift: { isGift: false, message: null },
  lines: [
    {
      kind: 'volume',
      slug: 'symphony',
      name: { ru: 'Symphony', uz: 'Symphony' },
      brand: 'Louis Vuitton',
      ml: 10,
      photo: null,
      unitPrice: 69_000,
      regularUnitPrice: 69_000,
      markedDown: false,
      qty: 1,
      lineTotal: 69_000,
      setComposition: null,
    },
  ],
  itemsSubtotal: 69_000,
  discount: null,
  deliveryFee: 25_000,
  thresholdBase: 'before',
  thresholdBaseAmount: 69_000,
  total: 94_000,
  amountDue: 94_000,
  cancellation: null,
  ...over,
});

afterEach(() => {
  cleanup();
  openManagerChat.mockReset();
  cancelOrder.mockReset();
  managerUsername = '@lummi_shop';
});

describe('order detail', () => {
  it('opens the manager account from the customer config («Написать менеджеру»)', () => {
    renderView(<OrderView order={order()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Написать менеджеру' }));
    expect(openManagerChat).toHaveBeenCalledWith('@lummi_shop');
  });

  it('leaves the link out until the config has arrived', () => {
    managerUsername = undefined;
    renderView(<OrderView order={order()} />);
    expect(screen.queryByRole('button', { name: 'Написать менеджеру' })).toBeNull();
  });

  it('marks a gift with its greeting and flags a typed address', () => {
    renderView(
      <OrderView
        order={order({
          gift: { isGift: true, message: 'С днём рождения!' },
          delivery: {
            region: { ru: 'Самаркандская область', uz: 'Samarqand viloyati' },
            point: null,
            typed: 'Ургут, рядом с базаром',
          },
        })}
      />,
    );
    expect(screen.getByTestId('gift-mark').textContent).toContain('«С днём рождения!»');
    expect(screen.getByTestId('order-delivery').textContent).toContain('Адрес указан вручную');
    expect(screen.getByTestId('order-delivery').textContent).toContain('Ургут, рядом с базаром');
  });
});

describe('cancelling an order', () => {
  it('offers «Отменить заказ» only while it waits for payment', () => {
    renderView(<OrderView order={order({ status: 'receipt_review' })} />);
    expect(screen.queryByTestId('cancel-order')).toBeNull();
    cleanup();
    renderView(<OrderView order={order()} />);
    expect(screen.getByTestId('cancel-order').textContent).toBe('Отменить заказ');
  });

  it('asks first, then sends the status the screen showed and closes on the answer', async () => {
    cancelOrder.mockResolvedValue({
      status: 200,
      body: order({
        status: 'cancelled',
        cancellation: { reason: 'customer_cancelled', at: '2026-11-09T11:00:00.000Z' },
      }),
    });
    renderView(<OrderView order={order()} />);
    fireEvent.click(screen.getByTestId('cancel-order'));
    expect(screen.getByRole('dialog', { name: 'Отменить заказ № 1001?' })).toBeTruthy();
    expect(cancelOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить заказ' }));
    await waitFor(() => expect(screen.queryByTestId('cancel-sheet')).toBeNull());
    expect(cancelOrder).toHaveBeenCalledWith({
      params: { number: 1001 },
      body: { expectedStatus: 'awaiting_payment' },
    });
  });

  it('keeps the sheet open with a line to try again when the request fails', async () => {
    cancelOrder.mockRejectedValue(new Error('offline'));
    renderView(<OrderView order={order()} />);
    fireEvent.click(screen.getByTestId('cancel-order'));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить заказ' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Не удалось отменить заказ');
    expect(screen.getByTestId('cancel-sheet')).toBeTruthy();
  });

  it('a cancelled order says why and when, with no timeline, amount or cancel', () => {
    renderView(
      <OrderView
        order={order({
          status: 'cancelled',
          cancellation: { reason: 'reserve_expired', at: '2026-11-09T22:00:00.000Z' },
        })}
      />,
    );
    expect(screen.getByTestId('cancelled').textContent).toBe(
      'Время брони истекло, а чек не поступилОтменён 10 ноября, 03:00',
    );
    expect(screen.queryByTestId('timeline')).toBeNull();
    expect(screen.queryByTestId('amount-due')).toBeNull();
    expect(screen.queryByTestId('cancel-order')).toBeNull();
  });
});

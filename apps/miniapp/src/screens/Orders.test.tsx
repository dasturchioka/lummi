import type { OrderSummaryDto } from '@lummi/contracts';
import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prefs', () => ({
  usePrefs: () => ({
    language: 'ru',
    theme: 'light',
    t: { ...sharedMessages.ru, ...miniappMessages.ru },
  }),
}));
vi.mock('../lib/telegram', () => ({ hapticSuccess: () => undefined }));
const listOrders = vi.fn();
const repeatOrder = vi.fn();
vi.mock('../lib/api', () => ({
  api: {
    orders: {
      list: (req: unknown) => listOrders(req),
      repeat: (req: unknown) => repeatOrder(req),
    },
  },
  unwrap: (res: { status: number; body: unknown }, status: number) => {
    if (res.status !== status) throw new Error(`HTTP ${res.status}`);
    return res.body;
  },
}));
const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate }) }));

import { Orders } from './Orders';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (number: number, status: OrderSummaryDto['status']): OrderSummaryDto => ({
  number,
  status,
  createdAt: '2026-11-09T10:00:00.000Z',
  total: 243_000,
  itemCount: 2,
  photos: [],
  isGift: false,
});

describe('«Заказы»: «Повторить заказ» under a finished row (mockup 08, #25)', () => {
  it('only a delivered or cancelled row has the link, beside the row’s button, not inside it', async () => {
    listOrders.mockResolvedValue({
      status: 200,
      body: {
        orders: [row(1003, 'awaiting_payment'), row(1002, 'delivered'), row(1001, 'cancelled')],
        next: null,
      },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Orders />
      </QueryClientProvider>,
    );
    const rows = await screen.findAllByTestId('order-row');
    expect(rows).toHaveLength(3);
    const links = screen.getAllByTestId('repeat-link');
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.closest('[data-testid="order-row"]')).toBeNull();
    expect(rows[0]!.closest('li')!.querySelector('[data-testid="repeat-link"]')).toBeNull();

    repeatOrder.mockResolvedValue({
      status: 200,
      body: {
        result: {
          lines: [
            {
              kind: 'volume',
              name: { ru: 'Symphony', uz: 'Symphony' },
              brand: 'Louis Vuitton',
              ml: 10,
              ordered: 1,
              added: 1,
              reason: null,
            },
          ],
          added: 1,
          of: 1,
        },
        cart: { lines: [], count: 1 },
      },
    });
    fireEvent.click(links[0]!);
    expect(await screen.findByRole('dialog', { name: 'Всё добавили в корзину' })).toBeTruthy();
    expect(repeatOrder).toHaveBeenCalledWith({ params: { number: 1002 } });
    // the link is not the row: the order page did not open
    expect(navigate).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { adminMessages } from '@lummi/i18n/admin';
import { ordersMessages } from '@lummi/i18n/orders';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The order page polls (#53); a poll that began before the page's own move is dropped, so the
 * answer of the move is never replaced by the older status.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: unknown }) => <a>{children as never}</a>,
}));
vi.mock('@/components/reviews/order-review', () => ({ OrderReviewSection: () => null }));
vi.mock('./order-sections', () => ({
  AuditSection: () => null,
  CustomerSection: () => null,
  DeliverySection: () => null,
  HistorySection: () => null,
  CommentSection: () => null,
  GiftSection: () => null,
  LinesSection: () => null,
  PaymentSection: () => null,
  ReceiptsSection: () => null,
}));
vi.mock('./order-dialogs', () => ({
  CancelDialog: () => null,
  ConfirmPaymentDialog: () => null,
  HandToBtsDialog: () => null,
  RefundDialog: () => null,
  RejectDialog: () => null,
  ReturnDialog: () => null,
}));
const get = vi.fn();
const fulfil = vi.fn();
vi.mock('@/lib/api', () => ({
  browserApi: {
    orders: { get: (a: unknown) => get(a), fulfil: (a: unknown) => fulfil(a) },
  },
}));

const { OrderPage } = await import('./order-page');
const { LIVE_POLL_MS } = await import('@/lib/use-visible-poll');

const t = adminMessages.ru.admin;
const status = ordersMessages.ru.orders.status;
const page = (s: string) =>
  ({
    order: { number: 1001, status: s, createdAt: '2026-11-16T05:00:00.000Z', cancellation: null },
    payment: 'confirmed',
    returned: null,
    returnPreview: null,
    money: { paid: null, refunded: 0, owed: 0, refundable: 0 },
  }) as unknown as ComponentProps<typeof OrderPage>['initial'];

const view = () => <OrderPage initial={page('payment_confirmed')} t={t} language="ru" />;
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  fulfil.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OrderPage live', () => {
  it('shows a status changed elsewhere within one interval', async () => {
    get.mockResolvedValue({ status: 200, body: page('accepted') });
    render(view());
    expect(screen.getByText(status.payment_confirmed)).toBeTruthy();
    await tick(LIVE_POLL_MS);
    expect(screen.getByText(status.accepted)).toBeTruthy();
  });

  it('drops a poll that started before the page’s own move', async () => {
    let late: (v: unknown) => void = () => undefined;
    get.mockReturnValue(new Promise((r) => (late = r)));
    fulfil.mockResolvedValue({ status: 200, body: page('accepted') });
    const { container } = render(view());
    await tick(LIVE_POLL_MS); // the poll is now in flight
    // the page's own move lands first; the poll answers with the older status afterwards
    fireEvent.click(container.querySelector('[data-next]') as HTMLElement);
    await tick(0);
    late({ status: 200, body: page('payment_confirmed') });
    await tick(0);
    expect(screen.getByText(status.accepted)).toBeTruthy();
    expect(screen.queryByText(status.payment_confirmed)).toBeNull();
  });

  it('sends a 401 to sign-in', async () => {
    get.mockResolvedValue({ status: 401, body: {} });
    render(view());
    await tick(LIVE_POLL_MS);
    expect(replace).toHaveBeenCalledWith('/login');
  });
});

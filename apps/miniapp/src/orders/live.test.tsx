// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Live order status (#53): an open order screen re-reads every LIVE_POLL_MS while the app is in
 * the foreground, stops in the background, and re-reads at once on return. The client is built
 * from the production defaults, so dropping a hook's own options fails here.
 */

const get = vi.fn();
const list = vi.fn();
const payment = vi.fn();
const cancel = vi.fn();
vi.mock('../lib/api', () => ({
  api: {
    orders: {
      get: (r: unknown) => get(r),
      list: (r: unknown) => list(r),
      payment: (r: unknown) => payment(r),
      cancel: (r: unknown) => cancel(r),
    },
  },
  unwrap: (res: { status: number; body: unknown }) => res.body,
}));
vi.mock('../lib/prefs', () => ({ usePrefs: () => ({ language: 'ru' }) }));
let telegramVisibility: ((e: { is_visible: boolean }) => void) | undefined;
vi.mock('@telegram-apps/sdk-react', () => ({
  on: (_: string, fn: (e: { is_visible: boolean }) => void) => {
    telegramVisibility = fn;
    return () => undefined;
  },
}));

import { queryDefaults } from '../app/queryDefaults';
import { installLiveFocus } from '../lib/live-focus';
import {
  LIVE_POLL_MS,
  orderKey,
  useCancelOrder,
  useOrder,
  useOrders,
  usePayment,
  holdPolls,
} from './queries';

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const order = (status: string) => ({ number: 1001, status });

let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
  uninstall = installLiveFocus();
  get.mockResolvedValue({ status: 200, body: order('awaiting_payment') });
  list.mockResolvedValue({ status: 200, body: { orders: [], next: null } });
  payment.mockResolvedValue({
    status: 200,
    body: { order: order('awaiting_payment'), card: null, receipts: [] },
  });
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.useRealTimers();
  vi.clearAllMocks();
  telegramVisibility = undefined;
});

const client = () =>
  new QueryClient({
    ...queryDefaults,
    defaultOptions: { queries: { ...queryDefaults.defaultOptions?.queries, retry: 0 } },
  });
function mount<T>(hook: () => T, qc = client()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(hook, { wrapper }) };
}

const screens: [string, () => unknown, typeof get][] = [
  ['useOrder', () => useOrder(1001), get],
  ['useOrders', () => useOrders(), list],
  ['usePayment', () => usePayment(1001), payment],
];

describe.each(screens)('live %s', (_name, hook, fetcher) => {
  it('polls while visible', async () => {
    mount(hook);
    await tick(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await tick(LIVE_POLL_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('stops in the background and re-reads at once on return', async () => {
    mount(hook);
    await tick(0);
    setVisibility('hidden');
    await tick(LIVE_POLL_MS * 5);
    expect(fetcher).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await tick(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('follows Telegram hiding and re-activating the Mini App', async () => {
    mount(hook);
    await tick(0);
    act(() => telegramVisibility?.({ is_visible: false }));
    await tick(LIVE_POLL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => telegramVisibility?.({ is_visible: true }));
    await tick(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('Telegram visible, then the tab hidden: polling stops', async () => {
    mount(hook);
    await tick(0);
    act(() => telegramVisibility?.({ is_visible: true }));
    await tick(0);
    const calls = fetcher.mock.calls.length; // a restore may re-read once
    setVisibility('hidden');
    await tick(LIVE_POLL_MS * 3);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});

describe('a poll in flight during a write', () => {
  it('does not put the old status back after a cancel', async () => {
    cancel.mockResolvedValue({ status: 200, body: order('cancelled') });
    const { qc, result } = mount(() => ({ order: useOrder(1001), cancel: useCancelOrder(1001) }));
    await tick(0);
    // the next poll starts, and answers only after the cancel has landed
    let answer: (v: unknown) => void = () => undefined;
    get.mockReturnValue(new Promise((r) => (answer = r)));
    await tick(LIVE_POLL_MS);
    await act(async () => {
      await result.current.cancel.mutateAsync('awaiting_payment');
    });
    answer({ status: 200, body: order('awaiting_payment') });
    await tick(10);
    expect((qc.getQueryData(orderKey(1001)) as { status: string }).status).toBe('cancelled');
  });

  it('holdPolls drops an in-flight read', async () => {
    const { qc } = mount(() => useOrder(1001));
    await tick(0);
    let answer: (v: unknown) => void = () => undefined;
    get.mockReturnValue(new Promise((r) => (answer = r)));
    await tick(LIVE_POLL_MS);
    await act(() => holdPolls(qc, 1001));
    qc.setQueryData(orderKey(1001), order('receipt_review'));
    answer({ status: 200, body: order('awaiting_payment') });
    await tick(10);
    expect((qc.getQueryData(orderKey(1001)) as { status: string }).status).toBe('receipt_review');
  });
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Live order status (#53): an open order screen re-reads every LIVE_POLL_MS while the app is in
 * the foreground, stops in the background, and re-reads at once on return.
 */

const get = vi.fn();
vi.mock('../lib/api', () => ({
  api: { orders: { get: (req: unknown) => get(req) } },
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

import { installLiveFocus } from '../lib/live-focus';
import { LIVE_POLL_MS, useOrder } from './queries';

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
  uninstall = installLiveFocus();
  get.mockResolvedValue({ status: 200, body: { number: 1001, status: 'awaiting_payment' } });
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, staleTime: 30_000 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useOrder(1001), { wrapper });
}

describe('live order status', () => {
  it('polls while visible and shows a status changed elsewhere', async () => {
    const { result } = mount();
    await tick(0);
    expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValue({ status: 200, body: { number: 1001, status: 'confirmed' } });
    await tick(LIVE_POLL_MS);
    expect(get).toHaveBeenCalledTimes(2);
    await tick(10);
    expect((result.current.data as { status: string }).status).toBe('confirmed');
  });

  it('stops polling in the background and re-reads at once on return', async () => {
    mount();
    await tick(0);
    setVisibility('hidden');
    await tick(LIVE_POLL_MS * 5);
    expect(get).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await tick(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('follows Telegram hiding and re-activating the Mini App', async () => {
    mount();
    await tick(0);
    act(() => telegramVisibility?.({ is_visible: false }));
    await tick(LIVE_POLL_MS * 3);
    expect(get).toHaveBeenCalledTimes(1);
    act(() => telegramVisibility?.({ is_visible: true }));
    await tick(0);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

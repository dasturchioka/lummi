// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_POLL_MS, useVisiblePoll } from './use-visible-poll';

function Probe({ tick }: { tick: (s: AbortSignal) => unknown }) {
  useVisiblePoll(tick as (s: AbortSignal) => void);
  return null;
}
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useVisiblePoll', () => {
  it('polls while visible, stops when hidden, and fetches on resume', async () => {
    const tick = vi.fn();
    render(<Probe tick={tick} />);
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2));
    expect(tick).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 5));
    expect(tick).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(tick).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it('fetches on window focus, but not right after a fetch', async () => {
    const tick = vi.fn();
    render(<Probe tick={tick} />);
    window.dispatchEvent(new Event('focus')); // just mounted: inside the gap
    expect(tick).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    window.dispatchEvent(new Event('focus'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('runs one fetch at a time and aborts it when gone', async () => {
    let signal: AbortSignal | undefined;
    const run = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<void>(() => undefined);
    });
    const { unmount } = render(<Probe tick={run} />);
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(run).toHaveBeenCalledTimes(1);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('stops on unmount', async () => {
    const tick = vi.fn();
    const { unmount } = render(<Probe tick={tick} />);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(tick).not.toHaveBeenCalled();
  });
});

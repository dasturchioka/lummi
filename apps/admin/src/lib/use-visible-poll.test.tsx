// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_POLL_MS, useVisiblePoll } from './use-visible-poll';

function Probe({ tick }: { tick: () => void }) {
  useVisiblePoll(tick);
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
  it('polls while visible, stops when hidden, and fetches on resume', () => {
    const tick = vi.fn();
    render(<Probe tick={tick} />);
    vi.advanceTimersByTime(LIVE_POLL_MS * 2);
    expect(tick).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    vi.advanceTimersByTime(LIVE_POLL_MS * 5);
    expect(tick).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    expect(tick).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(LIVE_POLL_MS);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it('stops on unmount', () => {
    const tick = vi.fn();
    const { unmount } = render(<Probe tick={tick} />);
    unmount();
    vi.advanceTimersByTime(LIVE_POLL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
  });
});

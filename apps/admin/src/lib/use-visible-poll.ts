'use client';

import { useEffect, useRef } from 'react';

/** How often a live admin screen refreshes while its tab is visible (UI constant, not a rule). */
export const LIVE_POLL_MS = 10_000;
/** A focus right after a poll does not fetch again. */
const FOCUS_GAP_MS = 2_000;

/**
 * Calls `tick` every `ms` while the tab is visible, stops in the background, and calls it at once
 * on resume or window focus (unless it just ran). The latest `tick` is always the one called.
 */
export function useVisiblePoll(tick: () => void, ms: number = LIVE_POLL_MS): void {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let last = Date.now();
    const run = () => {
      last = Date.now();
      latest.current();
    };
    const start = () => {
      clearInterval(timer);
      timer = setInterval(run, ms);
    };
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last > FOCUS_GAP_MS) run();
      start();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') clearInterval(timer);
      else resume();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', resume);
    };
  }, [ms]);
}

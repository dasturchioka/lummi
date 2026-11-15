'use client';

import { useCallback, useEffect, useRef } from 'react';

/** How often a live admin screen refreshes while its tab is visible (UI constant, not a rule). */
export const LIVE_POLL_MS = 10_000;
/** A focus right after a fetch does not fetch again. */
const FOCUS_GAP_MS = 2_000;

interface View {
  ctl: AbortController;
  inFlight: boolean;
}

/**
 * The one loop of live admin screens: `run` is called every `ms` while the tab is visible,
 * never in the background, and at once on resume or window focus (unless it just ran). The view
 * owns an AbortController, aborted when it goes (a late answer must change nothing: `run` checks
 * `signal.aborted`), and at most one `run` is in flight. `run` handles its own errors and 401.
 * `refresh()` is a manual fetch (a retry button) with the same guards. The latest `run` is called.
 */
export function useVisiblePoll(
  run: (signal: AbortSignal) => Promise<void> | void,
  { ms = LIVE_POLL_MS, immediate = false }: { ms?: number; immediate?: boolean } = {},
): { refresh: () => void } {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  const view = useRef<View | null>(null);
  const last = useRef(0);

  const refresh = useCallback(() => {
    const v = view.current;
    if (!v || v.ctl.signal.aborted || v.inFlight) return;
    v.inFlight = true;
    last.current = Date.now();
    void (async () => {
      try {
        await latest.current(v.ctl.signal);
      } catch {
        /* the caller decides what a failure shows */
      } finally {
        v.inFlight = false;
      }
    })();
  }, []);

  useEffect(() => {
    const mine: View = { ctl: new AbortController(), inFlight: false };
    view.current = mine;
    let timer: ReturnType<typeof setInterval> | undefined;
    /** Polls every `ms` from now: a fetch out of turn restarts the count. */
    const start = () => {
      clearInterval(timer);
      timer = setInterval(refresh, ms);
    };
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last.current > FOCUS_GAP_MS) refresh();
      start();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') clearInterval(timer);
      else resume();
    };
    if (immediate) refresh();
    else last.current = Date.now();
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', resume);
    return () => {
      mine.ctl.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', resume);
    };
  }, [ms, immediate, refresh]);

  return { refresh };
}

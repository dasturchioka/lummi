import type { SettingIssue } from './setting-issues';
import type { SettingKey } from './settings';

/*
 * Rules between settings (#36): one value that is fine alone can break another. The settings
 * service refuses such a save; services that read the values clamp them, should an old row break
 * the rule anyway.
 */

/**
 * The payment-feed guards (ADR 0012): how long the userbot may stay silent, and how long Humo may
 * send no credit while receipts wait, before every receipt timer pauses.
 */
export const FEED_GUARD_KEYS = [
  'payments.heartbeatStaleSeconds',
  'payments.humoSilenceSeconds',
] as const satisfies readonly SettingKey[];
/** What a feed guard must trip before: the wait window and the reserve. */
export const FEED_WINDOW_KEYS = [
  'payments.notFoundAfterSeconds',
  'orders.reserveTtlSeconds',
] as const satisfies readonly SettingKey[];

/** One worker tick: a guard trips at least this long before a window could end. */
export const FEED_GUARD_MARGIN_SECONDS = 60;

type FeedValues = Record<(typeof FEED_GUARD_KEYS | typeof FEED_WINDOW_KEYS)[number], number>;

/** The longest a feed guard may be: a tick shorter than the wait window and the reserve. */
export function feedGuardMax(v: Pick<FeedValues, (typeof FEED_WINDOW_KEYS)[number]>): number {
  return (
    Math.min(v['payments.notFoundAfterSeconds'], v['orders.reserveTtlSeconds']) -
    FEED_GUARD_MARGIN_SECONDS
  );
}

/** A guard as the services use it: clamped under `feedGuardMax`, whatever is stored. */
export function effectiveFeedGuard(seconds: number, v: Parameters<typeof feedGuardMax>[0]) {
  return Math.min(seconds, feedGuardMax(v));
}

/**
 * The issues saving `key` = `value` raises against the other settings' current values: a feed
 * guard at most `feedGuardMax`, a window at least a tick longer than both guards. Otherwise a
 * Humo feed failure could end a window before its payment pause starts, and cancel a paid order.
 */
export function crossSettingIssues(
  key: SettingKey,
  value: unknown,
  current: FeedValues,
): SettingIssue[] {
  if (typeof value !== 'number') return [];
  const next = { ...current, [key]: value } as FeedValues;
  if ((FEED_GUARD_KEYS as readonly string[]).includes(key)) {
    const max = feedGuardMax(next);
    return value > max ? [{ path: [], code: 'feed_guard_too_long', max }] : [];
  }
  if ((FEED_WINDOW_KEYS as readonly string[]).includes(key)) {
    const min = Math.max(...FEED_GUARD_KEYS.map((k) => next[k])) + FEED_GUARD_MARGIN_SECONDS;
    return value < min ? [{ path: [], code: 'wait_too_short', min }] : [];
  }
  return [];
}

/** The settings `crossSettingIssues` reads. */
export const CROSS_RULE_KEYS = [...FEED_GUARD_KEYS, ...FEED_WINDOW_KEYS] as const;

import { formatMoney } from '@lummi/i18n';
import { useState } from 'react';
import { usePrefs } from '../lib/prefs';

/** How many times a value has changed since mount (0 = never), to replay a small settle on change. */
function useChanges<V>(value: V): number {
  const [seen, setSeen] = useState({ value, n: 0 });
  if (!Object.is(seen.value, value)) setSeen({ value, n: seen.n + 1 });
  return seen.n;
}

/**
 * A server amount that settles in place when it changes, so totals never jump or flicker (the
 * cart's totals, checkout's summary and its dock). It takes its size and weight from the parent.
 */
export function Figure({
  amount,
  minus = false,
  className = '',
}: {
  amount: number;
  minus?: boolean;
  className?: string;
}) {
  const { language } = usePrefs();
  const n = useChanges(amount);
  return (
    <span
      key={n}
      className={`whitespace-nowrap tabular-nums ${n ? 'animate-[tick_0.22s_ease-out]' : ''} ${className}`}
    >
      {minus ? '−' : null}
      {formatMoney(amount, language)}
    </span>
  );
}

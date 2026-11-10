import { formatMoney } from '@lummi/i18n';
import { Fragment } from 'react';
import { usePrefs } from '../lib/prefs';

const SIZES = {
  /** 15 px 600: list prices, totals rows, a price inside a button. */
  price: 'type-price',
  /** 12.5 px 500: a price inside a control (volume tiles). */
  small: 'type-price-sm',
  /** 28 px 600: the amount to pay. */
  amount: 'type-amount',
} as const;

/** Integer so'm through the shared formatter: `100 000 сум` / `100 000 soʻm`. Never wraps, tabular. */
export function Money({
  amount,
  size = 'price',
  className = '',
}: {
  amount: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { language } = usePrefs();
  const text = formatMoney(amount, language);
  if (size !== 'amount') return <span className={`${SIZES[size]} ${className}`}>{text}</span>;
  // At 28 px the narrow no-break spaces close up into one block of digits: each gap is widened
  // (the currency's a little more), and stays a narrow no-break space when copied.
  const parts = text.split(NNBSP);
  return (
    <span className={`${SIZES[size]} ${className}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span className={i === parts.length - 1 ? 'pl-[0.2em]' : 'pl-[0.14em]'}>{NNBSP}</span>
          ) : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
const NNBSP = '\u202f';

import { formatMoney } from '@lummi/i18n';
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
  return <span className={`${SIZES[size]} ${className}`}>{formatMoney(amount, language)}</span>;
}

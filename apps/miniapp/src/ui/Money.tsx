import { formatMoney } from '@lummi/i18n';
import { usePrefs } from '../lib/prefs';

/** Integer so'm through the shared formatter: `100 000 сум` / `100 000 soʻm`. Never wraps, tabular. */
export function Money({
  amount,
  size = 'price',
  className = '',
}: {
  amount: number;
  size?: 'price' | 'amount';
  className?: string;
}) {
  const { language } = usePrefs();
  return (
    <span className={`${size === 'amount' ? 'type-amount' : 'type-price'} ${className}`}>
      {formatMoney(amount, language)}
    </span>
  );
}

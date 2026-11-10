import { sharedMessages } from './shared';
import type { Language } from './language';

const NNBSP = ' ';

/** Integer so'm -> `100 000 сум` / `100 000 soʻm`, narrow no-break spaces. */
export function formatMoney(amount: number, language: Language): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`amount must be an integer: ${amount}`);
  const sign = amount < 0 ? '-' : '';
  const grouped = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${sign}${grouped}${NNBSP}${sharedMessages[language].common.currency}`;
}

/**
 * A Credit's exact amount in tiyin (1/100 so'm) -> `75 750,50 сум`; a whole amount reads as
 * `formatMoney` does. Humo reports credits to the tiyin; orders are whole so'm.
 */
export function formatTiyin(amountTiyin: number, language: Language): string {
  if (!Number.isSafeInteger(amountTiyin) || amountTiyin < 0)
    throw new RangeError(`amount must be a non-negative integer: ${amountTiyin}`);
  const tiyin = amountTiyin % 100;
  const som = (amountTiyin - tiyin) / 100;
  if (tiyin === 0) return formatMoney(som, language);
  const grouped = String(som).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  const cents = String(tiyin).padStart(2, '0');
  return `${grouped},${cents}${NNBSP}${sharedMessages[language].common.currency}`;
}

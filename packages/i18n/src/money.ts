import { dictionaries } from './dictionaries';
import type { Language } from './language';

const NNBSP = ' ';

/** Integer so'm -> `100 000 сум` / `100 000 soʻm`, narrow no-break spaces. */
export function formatMoney(amount: number, language: Language): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`amount must be an integer: ${amount}`);
  const sign = amount < 0 ? '-' : '';
  const grouped = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${sign}${grouped}${NNBSP}${dictionaries[language].common.currency}`;
}

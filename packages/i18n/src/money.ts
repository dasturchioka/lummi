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

const LOCALES: Record<Language, string> = { ru: 'ru-RU', uz: 'uz-Latn-UZ' };
const separators = new Map<Language, string>();

/** The language's decimal separator, as `Intl` knows it (RU and UZ: a comma). */
function decimalSeparator(language: Language): string {
  let sep = separators.get(language);
  if (sep === undefined) {
    sep =
      new Intl.NumberFormat(LOCALES[language]).formatToParts(1.5).find((p) => p.type === 'decimal')
        ?.value ?? ',';
    separators.set(language, sep);
  }
  return sep;
}

/**
 * A plain number with `digits` decimals in the language's notation, thousands grouped with
 * narrow no-break spaces as `formatMoney` groups them: `1 250,5`, `0,97`. Not for money.
 */
export function formatDecimal(value: number, digits: number, language: Language): string {
  const [whole, fraction] = value.toFixed(digits).split('.') as [string, string | undefined];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return fraction === undefined ? grouped : `${grouped}${decimalSeparator(language)}${fraction}`;
}

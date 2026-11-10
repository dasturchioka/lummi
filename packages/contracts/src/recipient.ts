/**
 * Checkout input bounds and the recipient phone rule, without zod, so the Mini App can check a
 * field as it is typed with exactly the rule the server applies (`@lummi/contracts/client`).
 * These are input bounds, not business rules; the greeting card's own limit is the setting
 * `orders.giftMessageMaxLength` (GIFT_MESSAGE_HARD_MAX only caps the request body).
 */
export const RECIPIENT_NAME_MAX = 100;
export const ORDER_COMMENT_MAX = 500;
/** The typed fallback when the BTS point is missing (the picker's own form uses the same bounds). */
export const TYPED_ADDRESS_MIN = 3;
export const TYPED_ADDRESS_MAX = 300;
export const GIFT_MESSAGE_HARD_MAX = 1000;
/** The longest phone text a body may carry before it is normalised. */
export const RECIPIENT_PHONE_INPUT_MAX = 40;

/** National significant digits where a country fixes them; elsewhere E.164's 8-15 digits apply. */
const NATIONAL_DIGITS: Record<string, number> = { '998': 9 };

/**
 * The recipient's phone as typed (`+998 90 123-45-67`, `998901234567`, `90 123 45 67`) to E.164,
 * or null when it is not a number of one of `countryCodes` (setting
 * `orders.recipientPhoneCountryCodes`, digits without `+`). Nine digits without a `+` read as an
 * Uzbek local number when `998` is allowed.
 */
export function normalizeRecipientPhone(
  input: string,
  countryCodes: readonly string[],
): string | null {
  const trimmed = input.trim();
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+') && digits.length === 9 && countryCodes.includes('998'))
    return `+998${digits}`;
  const code = [...countryCodes]
    .sort((a, b) => b.length - a.length)
    .find((c) => digits.startsWith(c));
  if (code === undefined) return null;
  const national = digits.length - code.length;
  const fixed = NATIONAL_DIGITS[code];
  const fits = fixed !== undefined ? national === fixed : digits.length >= 8 && digits.length <= 15;
  return fits ? `+${digits}` : null;
}

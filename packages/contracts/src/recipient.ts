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

/**
 * The recipient's phone as typed (`+998 90 123-45-67`, `998901234567`, `90 123 45 67`) to E.164,
 * or null when it is not an Uzbek number: BTS hands the parcel over in Uzbekistan, so the
 * recipient is reached on a `+998` number with nine national digits.
 */
export function normalizeRecipientPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  const national =
    digits.length === 12 && digits.startsWith('998')
      ? digits.slice(3)
      : digits.length === 9 && !trimmed.startsWith('+')
        ? digits
        : null;
  return national ? `+998${national}` : null;
}

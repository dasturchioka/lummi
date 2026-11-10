import type { PromoCodeInvalid } from '@lummi/contracts';
import { fill, formatDuration, formatMoney, type Language } from '@lummi/i18n';
import type { usePrefs } from '../lib/prefs';

type T = ReturnType<typeof usePrefs>['t'];

/** Why the entered code is not applied, as the shopper reads it (the server's reason, ticket #29). */
export function promoReasonText(invalid: PromoCodeInvalid, t: T, language: Language): string {
  const r = t.cart.promo.reasons;
  if (invalid.reason === 'below_minimum' && 'minOrderTotal' in invalid)
    return fill(r.below_minimum, { amount: formatMoney(invalid.minOrderTotal, language) });
  return r[invalid.reason];
}

/** What the shopper can do about that reason in the cart: fix the code, add to the order, or go on without it. */
export function promoNextText(invalid: PromoCodeInvalid, t: T): string {
  return t.cart.promo.next[invalid.reason];
}

/** «До следующей попытки — 9 минут»: the wait rounded up to whole minutes, never «0 минут». */
export function promoWaitText(seconds: number, t: T, language: Language): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return fill(t.cart.promo.tooManyNext, { time: formatDuration(minutes * 60, language) });
}

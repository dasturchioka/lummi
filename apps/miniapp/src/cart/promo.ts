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

/** «До следующей: 9 минут»: the wait rounded up to whole minutes, so it never says «0 минут». */
export function promoWaitText(seconds: number, t: T, language: Language): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return fill(t.cart.promo.tooMany, { time: formatDuration(minutes * 60, language) });
}

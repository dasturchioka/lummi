import { fill } from './fill';
import type { Language } from './language';
import { sharedMessages } from './shared';

/** A Promo gift with what names it: a volume of a fragrance, or the Discovery set. */
export type NamedPromoGift =
  { kind: 'volume'; name: string; ml: number } | { kind: 'discovery_set' };

/**
 * The one name of a Promo gift (ADR 0039), in the reader's language: «Rain Tea 10 мл» /
 * «Rain Tea 10 ml», or «Discovery set». The admin list and audit, the orders group card and the
 * bot's «Заказ оформлен» all say it this way.
 */
export function promoGiftLabel(gift: NamedPromoGift, language: Language): string {
  const m = sharedMessages[language].promoGift;
  return gift.kind === 'discovery_set'
    ? m.discovery
    : fill(m.volume, { name: gift.name, ml: String(gift.ml) });
}

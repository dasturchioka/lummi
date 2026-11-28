import { promoGiftLabel, type Language } from '@lummi/i18n';
import type { OrderLineRow } from '@lummi/db';

/**
 * A Promo gift order line by its one name (ADR 0039), in `language`: «Rain Tea 10 мл» or
 * «Discovery set». The orders group card and the bot's «Заказ оформлен» say it this way.
 */
export function lineGiftLabel(
  l: Pick<OrderLineRow, 'kind' | 'nameRu' | 'nameUz' | 'ml'>,
  language: Language,
): string {
  return promoGiftLabel(
    l.kind === 'volume'
      ? { kind: 'volume', name: language === 'uz' ? l.nameUz : l.nameRu, ml: l.ml }
      : { kind: 'discovery_set' },
    language,
  );
}

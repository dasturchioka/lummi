import type { PromoGiftLineDto } from '@lummi/contracts';
import type { OrderLineView } from '../orders/OrderLine';

/**
 * A gift code's free item (ADR 0039) as a line row reads it: quantity 1 at 0, «Подарок по
 * промокоду». The Discovery set takes its name in the shopper's language, as a set line does.
 */
export function promoGiftLine(gift: PromoGiftLineDto, discoveryName: string): OrderLineView {
  const common = { photo: gift.photo, qty: 1, lineTotal: 0, markedDown: false, promoGift: true };
  if (gift.kind === 'volume')
    return {
      ...common,
      kind: 'volume',
      brand: gift.brand,
      name: { ru: gift.name, uz: gift.name },
      setComposition: null,
      ml: gift.ml,
    };
  return {
    ...common,
    kind: 'discovery_set',
    brand: null,
    name: { ru: discoveryName, uz: discoveryName },
    setComposition: gift.fragrances.map(({ name, brand }) => ({ name, brand })),
    ml: 10,
  };
}

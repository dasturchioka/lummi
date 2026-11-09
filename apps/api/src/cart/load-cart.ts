import type { DeliveryCityDto, Quote } from '@lummi/contracts';
import {
  asc,
  cartLines,
  carts,
  eq,
  fragrances,
  volumes,
  type CartRow,
  type DbOrTx,
} from '@lummi/db';
import { available, reservedByVolume } from '../catalog/catalog.service';
import { readDeliveryCity } from '../delivery/delivery.service';
import { quote, type Entitlement, type QuoteLineInput } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';

/** A cart line as the quote sees it: the quantity capped at available, the wish kept apart. */
export interface CartLineView {
  lineId: number;
  volumeId: number;
  fragranceId: number;
  slug: string;
  name: string;
  ml: number;
  photo: string | null;
  /** What the quote counts: never above `available` (a sold-out line keeps its own). */
  qty: number;
  /** What the customer asked for. */
  wanted: number;
  available: number;
  soldOut: boolean;
  limited: boolean;
}

export interface LoadedCart {
  lines: CartLineView[];
  quote: Quote;
  state: CartRow | undefined;
  city: DeliveryCityDto | null;
}

/**
 * The cart's lines capped at available, priced through `quote()` (ADR 0001). The one place that
 * turns stored lines into a Quote: the cart screen and checkout (#23, inside its transaction)
 * both come through here. `entitlements` is for the discount tickets; none are held yet.
 */
export async function loadCartQuote(
  tx: DbOrTx,
  now: Date,
  customerId: number,
  opts: { entitlements?: Entitlement[] } = {},
): Promise<LoadedCart> {
  const rows = await tx
    .select({
      lineId: cartLines.id,
      volumeId: cartLines.volumeId,
      fragranceId: fragrances.id,
      slug: fragrances.slug,
      name: fragrances.name,
      hidden: fragrances.hidden,
      ml: volumes.ml,
      photo: volumes.photoHash,
      qty: cartLines.qty,
      price: volumes.price,
      salePrice: volumes.salePrice,
      saleEndsAt: volumes.saleEndsAt,
      onHand: volumes.onHand,
    })
    .from(cartLines)
    .innerJoin(volumes, eq(volumes.id, cartLines.volumeId))
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(eq(cartLines.customerId, customerId))
    .orderBy(asc(cartLines.id));
  const reserved = await reservedByVolume(
    tx,
    rows.map((r) => r.volumeId),
  );
  const lines: (CartLineView & {
    price: number;
    salePrice: number | null;
    saleEndsAt: Date | null;
  })[] = rows.map((r) => {
    // a hidden fragrance is not for sale: its line stays, flagged like a sold-out one
    const left = r.hidden ? 0 : available(r.onHand, reserved.get(r.volumeId) ?? 0);
    return {
      lineId: r.lineId,
      volumeId: r.volumeId,
      fragranceId: r.fragranceId,
      slug: r.slug,
      name: r.name,
      ml: r.ml,
      photo: r.photo,
      wanted: r.qty,
      available: left,
      soldOut: left === 0,
      qty: left === 0 ? r.qty : Math.min(r.qty, left),
      limited: left > 0 && r.qty > left,
      price: r.price,
      salePrice: r.salePrice,
      saleEndsAt: r.saleEndsAt,
    };
  });

  const [state] = await tx.select().from(carts).where(eq(carts.customerId, customerId));
  const city = await readDeliveryCity(tx, customerId);
  const settings = await readSettings(tx, [
    'pricing.freeDeliveryThreshold',
    'pricing.thresholdBase',
    'pricing.discountsApplyToMarkedDown',
    'pricing.fullSizeVolumesMl',
    'delivery.defaultTariff',
  ]);
  const quoteLines: QuoteLineInput[] = lines.map((l) => ({
    key: String(l.lineId),
    item: { kind: 'volume', fragranceId: l.fragranceId, volumeMl: l.ml },
    qty: l.qty,
    price: {
      regular: l.price,
      markdown: l.salePrice === null ? null : { price: l.salePrice, endsAt: l.saleEndsAt },
    },
    soldOut: l.soldOut,
  }));
  const q = quote({
    lines: quoteLines,
    entitlements: opts.entitlements ?? [],
    promoCode: null,
    choice: state?.discountChoice ?? null,
    deliveryTariff: city?.region.deliveryTariff ?? settings['delivery.defaultTariff'],
    settings: {
      freeDeliveryThreshold: settings['pricing.freeDeliveryThreshold'],
      thresholdBase: settings['pricing.thresholdBase'],
      discountsApplyToMarkedDown: settings['pricing.discountsApplyToMarkedDown'],
      fullSizeVolumesMl: settings['pricing.fullSizeVolumesMl'],
    },
    now,
  });
  return {
    lines: lines.map(({ price: _p, salePrice: _s, saleEndsAt: _e, ...view }) => view),
    quote: q,
    state,
    city,
  };
}

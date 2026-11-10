import type { DeliveryCityDto, Quote } from '@lummi/contracts';
import { CART_MAX_QTY } from '@lummi/contracts/constants';
import {
  and,
  asc,
  cartLines,
  carts,
  eq,
  fragrances,
  ne,
  volumes,
  type CartRow,
  type DbOrTx,
} from '@lummi/db';
import { available, reservedByVolume } from '../catalog/catalog.service';
import { readDeliveryCity } from '../delivery/delivery.service';
import { quote, type Entitlement, type QuoteLineInput } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import {
  builderAvailable,
  loadDiscovery,
  tenMlOf,
} from '../sets/sets';

/** What every cart line carries: the quantity capped at available, the wish kept apart. */
interface LineBase {
  lineId: number;
  photo: string | null;
  /** What the quote counts: never above `available` (a sold-out line keeps its own). */
  qty: number;
  /** What the customer asked for. */
  wanted: number;
  available: number;
  soldOut: boolean;
  limited: boolean;
}

export interface VolumeLineView extends LineBase {
  kind: 'volume';
  volumeId: number;
  fragranceId: number;
  slug: string;
  name: string;
  brand: string;
  ml: number;
}

/** The Discovery set or a builder set: five fragrances, 10 ml each. */
export interface SetLineView extends LineBase {
  kind: 'discovery' | 'builder';
  fragrances: { slug: string; name: string; brand: string }[];
}

export type CartLineView = VolumeLineView | SetLineView;

/** Caps what the customer asked for at what is available; a sold-out line keeps its own. */
function capped(wanted: number, left: number) {
  return {
    wanted,
    available: left,
    soldOut: left === 0,
    // never above the per-line ceiling either, whatever a relink added up
    qty: left === 0 ? Math.min(wanted, CART_MAX_QTY) : Math.min(wanted, left, CART_MAX_QTY),
    limited: left > 0 && wanted > left,
  };
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
      brand: fragrances.originalBrand,
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
    .where(and(eq(cartLines.customerId, customerId), eq(cartLines.kind, 'volume')))
    .orderBy(asc(cartLines.id));
  const reserved = await reservedByVolume(
    tx,
    rows.map((r) => r.volumeId!),
  );
  type Priced = { price: number; salePrice: number | null; saleEndsAt: Date | null };
  const volumeLines: (VolumeLineView & Priced)[] = rows.map((r) => {
    // a hidden fragrance is not for sale: its line stays, flagged like a sold-out one
    const left = r.hidden ? 0 : available(r.onHand, reserved.get(r.volumeId!) ?? 0);
    return {
      kind: 'volume',
      lineId: r.lineId,
      volumeId: r.volumeId!,
      fragranceId: r.fragranceId,
      slug: r.slug,
      name: r.name,
      brand: r.brand,
      ml: r.ml,
      photo: r.photo,
      ...capped(r.qty, left),
      price: r.price,
      salePrice: r.salePrice,
      saleEndsAt: r.saleEndsAt,
    };
  });

  // Set lines (ADR 0009): the Discovery set from its own stock, a builder set from each chosen 10 ml.
  const setRows = await tx
    .select({
      lineId: cartLines.id,
      kind: cartLines.kind,
      fragranceIds: cartLines.fragranceIds,
      qty: cartLines.qty,
    })
    .from(cartLines)
    .where(and(eq(cartLines.customerId, customerId), ne(cartLines.kind, 'volume')))
    .orderBy(asc(cartLines.id));
  const setLines: SetLineView[] = [];
  let setPrice = 0;
  if (setRows.length > 0) {
    const discovery = await loadDiscovery(tx);
    setPrice = discovery.row.price;
    const builderIds = [...new Set(setRows.flatMap((r) => r.fragranceIds ?? []))];
    const tenMl = await tenMlOf(tx, { ids: builderIds });
    const tenMlOfFragrance = new Map(tenMl.map((t) => [t.fragranceId, t]));
    for (const r of setRows) {
      if (r.kind === 'discovery') {
        setLines.push({
          kind: 'discovery',
          lineId: r.lineId,
          photo: discovery.row.photoHash,
          fragrances: discovery.composition.map((f) => ({
            slug: f.slug,
            name: f.name,
            brand: f.brand,
          })),
          ...capped(r.qty, discovery.available),
        });
      } else {
        const five = (r.fragranceIds ?? []).flatMap((id) => tenMlOfFragrance.get(id) ?? []);
        setLines.push({
          kind: 'builder',
          lineId: r.lineId,
          photo: null,
          fragrances: five.map((t) => ({ slug: t.slug, name: t.name, brand: t.brand })),
          ...capped(r.qty, builderAvailable(five)),
        });
      }
    }
  }
  const lines: CartLineView[] = [...volumeLines, ...setLines].sort((a, b) => a.lineId - b.lineId);

  const [state] = await tx.select().from(carts).where(eq(carts.customerId, customerId));
  const city = await readDeliveryCity(tx, customerId);
  const settings = await readSettings(tx, [
    'pricing.freeDeliveryThreshold',
    'pricing.thresholdBase',
    'pricing.discountsApplyToMarkedDown',
    'pricing.fullSizeVolumesMl',
    'delivery.defaultTariff',
  ]);
  const quoteLines: QuoteLineInput[] = [
    ...volumeLines.map((l): QuoteLineInput => ({
      key: String(l.lineId),
      item: { kind: 'volume', fragranceId: l.fragranceId, volumeMl: l.ml },
      qty: l.qty,
      price: {
        regular: l.price,
        markdown: l.salePrice === null ? null : { price: l.salePrice, endsAt: l.saleEndsAt },
      },
      soldOut: l.soldOut,
    })),
    // both kinds of set cost the Discovery set's price and are never marked down
    ...setLines.map((l): QuoteLineInput => ({
      key: String(l.lineId),
      item: { kind: 'set' },
      qty: l.qty,
      price: { regular: setPrice, markdown: null },
      soldOut: l.soldOut,
    })),
  ];
  quoteLines.sort((a, b) => Number(a.key) - Number(b.key));
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
    lines,
    quote: q,
    state,
    city,
  };
}

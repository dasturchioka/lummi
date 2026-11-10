import type { DeliveryCityDto, Quote } from '@lummi/contracts';
import { CART_MAX_QTY, SET_SIZE } from '@lummi/contracts/constants';
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
import { judgePromoCode, type JudgedPromoCode } from '../promo/promo-codes';
import { readSettings } from '../settings/settings.service';
import { loadDiscovery, tenMlOf, type DiscoveryState, type TenMl } from '../sets/sets';

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

/** One of a set's five fragrances, as the cart shows it and the order snapshot keeps it. */
export interface SetItem {
  fragranceId: number;
  slug: string;
  name: string;
  brand: string;
}

/** The Discovery set: five fragrances from its own stock, never touching 10 ml. */
export interface DiscoveryLineView extends LineBase {
  kind: 'discovery_set';
  items: SetItem[];
}

/** A builder set: five fragrances, one 10 ml of each (`volumeId`) per set unit. */
export interface BuilderLineView extends LineBase {
  kind: 'builder_set';
  items: (SetItem & { volumeId: number })[];
  /** Which picks leave the line sold out; `inCart`: only because an earlier line took the last unit. */
  short: { slug: string; name: string; inCart: boolean }[];
}

export type SetLineView = DiscoveryLineView | BuilderLineView;

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
  /** The entered promo code's id when it passed the DB checks; the order holds a use of it. */
  promoCodeId: number | null;
}

/**
 * The cart's lines capped at available, priced through `quote()` (ADR 0001). The one place that
 * turns stored lines into a Quote: the cart screen and checkout (inside its transaction, after
 * the stock rows are locked) both come through here. `entitlements` is for the discount tickets;
 * none are held yet. The entered promo code is judged here (the DB checks, ticket #29), and
 * `quote()` applies it or says why not. `deliveryTariff` is checkout's: the chosen BTS point's region tariff, which
 * wins over the saved delivery city's.
 */
export async function loadCartQuote(
  tx: DbOrTx,
  now: Date,
  customerId: number,
  opts: { entitlements?: Entitlement[]; deliveryTariff?: number } = {},
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
  let setPrice = 0;
  let discovery: DiscoveryState | null = null;
  let tenMlOfFragrance = new Map<number, TenMl>();
  if (setRows.length > 0) {
    discovery = await loadDiscovery(tx);
    setPrice = discovery.row.price;
    const composed = setRows.some((r) => r.kind === 'discovery_set') ? discovery.composition : [];
    const wantedIds = [
      ...new Set([...setRows.flatMap((r) => r.fragranceIds ?? []), ...composed.map((f) => f.id)]),
    ];
    tenMlOfFragrance = new Map(
      (await tenMlOf(tx, { ids: wantedIds })).map((t) => [t.fragranceId, t]),
    );
  }

  // What each volume still has for the lines after the ones already placed, in line order: one 10 ml
  // may sit in a volume line and in builder sets of the same cart, and the last unit is sold once
  // (ADR 0010). A line that no longer fits is flagged like a sold-out one and takes nothing.
  const free = new Map<number, number>();
  for (const r of rows)
    free.set(r.volumeId!, r.hidden ? 0 : available(r.onHand, reserved.get(r.volumeId!) ?? 0));
  for (const t of tenMlOfFragrance.values()) free.set(t.volumeId, t.available);
  const take = (volumeIds: number[], qty: number) => {
    for (const id of volumeIds) free.set(id, (free.get(id) ?? 0) - qty);
  };

  const volumeById = new Map(rows.map((r) => [r.lineId, r]));
  const setById = new Map(setRows.map((r) => [r.lineId, r]));
  const volumeLines: (VolumeLineView & Priced)[] = [];
  const setLines: SetLineView[] = [];
  const ordered = [...rows.map((r) => r.lineId), ...setRows.map((r) => r.lineId)].sort(
    (a, b) => a - b,
  );
  for (const lineId of ordered) {
    const r = volumeById.get(lineId);
    if (r) {
      // a hidden fragrance is not for sale: its line stays, flagged like a sold-out one
      const view = capped(r.qty, free.get(r.volumeId!) ?? 0);
      if (!view.soldOut) take([r.volumeId!], view.qty);
      volumeLines.push({
        kind: 'volume',
        lineId: r.lineId,
        volumeId: r.volumeId!,
        fragranceId: r.fragranceId,
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        ml: r.ml,
        photo: r.photo,
        ...view,
        price: r.price,
        salePrice: r.salePrice,
        saleEndsAt: r.saleEndsAt,
      });
      continue;
    }
    const sr = setById.get(lineId)!;
    if (sr.kind === 'discovery_set' && discovery) {
      setLines.push({
        kind: 'discovery_set',
        lineId: sr.lineId,
        photo: discovery.row.photoHash,
        items: discovery.composition.map((f) => ({
          fragranceId: f.id,
          slug: f.slug,
          name: f.name,
          brand: f.brand,
        })),
        ...capped(sr.qty, discovery.available),
      });
    } else {
      const five = (sr.fragranceIds ?? []).flatMap((id) => tenMlOfFragrance.get(id) ?? []);
      const view = capped(
        sr.qty,
        five.length === SET_SIZE ? Math.min(...five.map((t) => free.get(t.volumeId) ?? 0)) : 0,
      );
      const short = view.soldOut
        ? five
            .filter((t) => (free.get(t.volumeId) ?? 0) <= 0)
            .map((t) => ({ slug: t.slug, name: t.name, inCart: t.available > 0 }))
        : [];
      if (!view.soldOut)
        take(
          five.map((t) => t.volumeId),
          view.qty,
        );
      setLines.push({
        kind: 'builder_set',
        lineId: sr.lineId,
        photo: null,
        items: five.map((t) => ({
          fragranceId: t.fragranceId,
          volumeId: t.volumeId,
          slug: t.slug,
          name: t.name,
          brand: t.brand,
        })),
        short,
        ...view,
      });
    }
  }
  const lines: CartLineView[] = [...volumeLines, ...setLines].sort((a, b) => a.lineId - b.lineId);

  const [state] = await tx.select().from(carts).where(eq(carts.customerId, customerId));
  const city = await readDeliveryCity(tx, customerId);
  const judged: JudgedPromoCode | null = state?.promoCode
    ? await judgePromoCode(tx, state.promoCode, customerId, now)
    : null;
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
    promoCode: judged?.promoCode ?? null,
    choice: state?.discountChoice ?? null,
    deliveryTariff:
      opts.deliveryTariff ?? city?.region.deliveryTariff ?? settings['delivery.defaultTariff'],
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
    promoCodeId: judged?.promoCodeId ?? null,
  };
}

import type { CartLineDto, DeliveryCityDto, Quote } from '@lummi/contracts';
import { CART_MAX_QTY, SET_SIZE, type LineKind } from '@lummi/contracts/constants';
import {
  asc,
  cartLines,
  carts,
  eq,
  fragrances,
  inArray,
  volumes,
  type CartRow,
  type DbOrTx,
} from '@lummi/db';
import { available, reservedByVolume } from '../catalog/catalog.service';
import { readDeliveryCity } from '../delivery/delivery.service';
import { quote, type Entitlement, type QuoteLineInput } from '../pricing/quote';
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
  /** The cart row (discount choice, promo code); undefined for lines quoted on their own. */
  state: CartRow | undefined;
  city: DeliveryCityDto | null;
}

/** A line as stored: what was asked for. Volume, price and stock are resolved when it is read. */
export interface StoredLine {
  lineId: number;
  kind: LineKind;
  volumeId: number | null;
  fragranceIds: number[] | null;
  qty: number;
}

/**
 * Where a quote's lines come from: the customer's cart (with its stored discount choice), or lines
 * given here and quoted on their own, with no stored choice and no promo code. «Купить сейчас»
 * gives its one line; «Повторить заказ» gives the cart's lines followed by the old order's, to see
 * what each old line can still take (spec Changes 2026-11-11).
 */
export type LineSource = { kind: 'cart' } | { kind: 'lines'; lines: readonly StoredLine[] };

/** The customer's cart lines as stored, in line order. */
export async function readCartLines(tx: DbOrTx, customerId: number): Promise<StoredLine[]> {
  return tx
    .select({
      lineId: cartLines.id,
      kind: cartLines.kind,
      volumeId: cartLines.volumeId,
      fragranceIds: cartLines.fragranceIds,
      qty: cartLines.qty,
    })
    .from(cartLines)
    .where(eq(cartLines.customerId, customerId))
    .orderBy(asc(cartLines.id));
}

/** The cart's quote: `loadQuote` with the cart as the line source. */
export function loadCartQuote(
  tx: DbOrTx,
  now: Date,
  customerId: number,
  opts: { entitlements?: Entitlement[]; deliveryTariff?: number } = {},
): Promise<LoadedCart> {
  return loadQuote(tx, now, customerId, { kind: 'cart' }, opts);
}

/**
 * Lines capped at available, priced through `quote()` (ADR 0001). The one place that turns stored
 * lines into a Quote: the cart screen, checkout (inside its transaction, after the stock rows are
 * locked) and «Купить сейчас» all come through here, so a line is judged and priced one way.
 * `entitlements` is for the discount tickets; none are held yet. `deliveryTariff` is checkout's:
 * the chosen BTS point's region tariff, which wins over the saved delivery city's.
 */
export async function loadQuote(
  tx: DbOrTx,
  now: Date,
  customerId: number,
  source: LineSource,
  opts: { entitlements?: Entitlement[]; deliveryTariff?: number } = {},
): Promise<LoadedCart> {
  const stored =
    source.kind === 'cart'
      ? await readCartLines(tx, customerId)
      : [...source.lines].sort((a, b) => a.lineId - b.lineId);
  const askedVolumes = stored.flatMap((l) =>
    l.kind === 'volume' && l.volumeId !== null ? [l.volumeId] : [],
  );
  const volumeInfo =
    askedVolumes.length === 0
      ? []
      : await tx
          .select({
            volumeId: volumes.id,
            fragranceId: fragrances.id,
            slug: fragrances.slug,
            name: fragrances.name,
            brand: fragrances.originalBrand,
            hidden: fragrances.hidden,
            ml: volumes.ml,
            photo: volumes.photoHash,
            price: volumes.price,
            salePrice: volumes.salePrice,
            saleEndsAt: volumes.saleEndsAt,
            onHand: volumes.onHand,
          })
          .from(volumes)
          .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
          .where(inArray(volumes.id, askedVolumes));
  const infoOf = new Map(volumeInfo.map((v) => [v.volumeId, v]));
  const rows = stored.flatMap((l) => {
    const v = l.kind === 'volume' && l.volumeId !== null ? infoOf.get(l.volumeId) : undefined;
    return v ? [{ ...v, lineId: l.lineId, qty: l.qty }] : [];
  });
  const reserved = await reservedByVolume(
    tx,
    rows.map((r) => r.volumeId),
  );
  type Priced = { price: number; salePrice: number | null; saleEndsAt: Date | null };

  // Set lines (ADR 0009): the Discovery set from its own stock, a builder set from each chosen 10 ml.
  const setRows = stored.filter((l) => l.kind !== 'volume');
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
    free.set(r.volumeId, r.hidden ? 0 : available(r.onHand, reserved.get(r.volumeId) ?? 0));
  for (const t of tenMlOfFragrance.values()) free.set(t.volumeId, t.available);
  const take = (volumeIds: number[], qty: number) => {
    for (const id of volumeIds) free.set(id, (free.get(id) ?? 0) - qty);
  };
  // the Discovery set's own stock, shared the same way (a cart holds one Discovery line, but
  // «Повторить заказ» weighs the old order's after it)
  let discoveryFree = discovery?.available ?? 0;

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
      const view = capped(r.qty, free.get(r.volumeId) ?? 0);
      if (!view.soldOut) take([r.volumeId], view.qty);
      volumeLines.push({
        kind: 'volume',
        lineId: r.lineId,
        volumeId: r.volumeId,
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
      const view = capped(sr.qty, discoveryFree);
      if (!view.soldOut) discoveryFree -= view.qty;
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
        ...view,
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

  const [state] =
    source.kind === 'cart'
      ? await tx.select().from(carts).where(eq(carts.customerId, customerId))
      : [];
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
  };
}

/** A line as the Mini App shows it, without its cart line id (a «Купить сейчас» line has none). */
export function toLineDto(l: CartLineView): DistributiveOmit<CartLineDto, 'id'> {
  const base = {
    photo: l.photo,
    qty: l.qty,
    available: l.available,
    soldOut: l.soldOut,
    limited: l.limited,
  };
  const fragrancesOf = (items: SetItem[]) =>
    items.map(({ slug, name, brand }) => ({ slug, name, brand }));
  switch (l.kind) {
    case 'volume':
      return {
        ...base,
        kind: 'volume',
        slug: l.slug,
        name: l.name,
        brand: l.brand,
        ml: l.ml as 10 | 30 | 50,
      };
    case 'builder_set':
      return { ...base, kind: l.kind, fragrances: fragrancesOf(l.items), short: l.short };
    case 'discovery_set':
      return { ...base, kind: l.kind, fragrances: fragrancesOf(l.items) };
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

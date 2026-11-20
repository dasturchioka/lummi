import {
  promoGiftOf,
  type CartLineDto,
  type DeliveryCityDto,
  type PromoGiftItem,
  type PromoGiftLineDto,
  type Quote,
} from '@lummi/contracts';
import {
  asDiscoveryVialMl,
  CART_MAX_QTY,
  SET_SIZE,
  SET_VIAL_ML,
  type DiscoveryVialMl,
  type LineKind,
} from '@lummi/contracts/constants';
import {
  and,
  asc,
  cartLines,
  carts,
  eq,
  fragrances,
  inArray,
  sellableVolume,
  volumes,
  type CartRow,
  type DbOrTx,
} from '@lummi/db';
import { bottlesOf, readLiquidStock } from '../catalog/catalog.service';
import { readDeliveryCity } from '../delivery/delivery.service';
import { loadEntitlements } from '../entitlements/entitlements';
import { readPricingSettings } from '../pricing/pricing-settings';
import {
  quote,
  volumePrice,
  type Entitlement,
  type PromoCode,
  type QuoteLineInput,
  type RefusedPromoCode,
} from '../pricing/quote';
import { judgePromoCode, type JudgedPromoCode, type PromoTerms } from '../promo/promo-codes';
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

/** A Discovery set (5 × 10 ml or 5 × 5 ml, ADR 0042): five fragrances from its own stock, never touching a bottle's. */
export interface DiscoveryLineView extends LineBase {
  kind: 'discovery_set';
  vialMl: DiscoveryVialMl;
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

/**
 * A gift code's item (ADR 0039) as the cart found it: what the order snapshot and the cart show,
 * its regular price, and whether none is left after the cart's own lines.
 */
export type PromoGiftView = { regular: number; soldOut: boolean; photo: string | null } & (
  | {
      kind: 'volume';
      volumeId: number;
      fragranceId: number;
      slug: string;
      name: string;
      brand: string;
      ml: number;
    }
  | { kind: 'discovery_set'; vialMl: DiscoveryVialMl; items: SetItem[] }
);

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

export interface LoadedQuote {
  lines: CartLineView[];
  quote: Quote;
  /** The cart row (discount choice, promo code); undefined for lines quoted on their own. */
  cartState: CartRow | undefined;
  city: DeliveryCityDto | null;
  /** The entered promo code's id when it passed the DB checks; the order holds a use of it. */
  promoCodeId: number | null;
  /** The customer's active entitlements the quote chose from. */
  entitlements: Entitlement[];
  /** The entered gift code's Promo gift, whether the quote applied it or not; null for any other code. */
  promoGift: PromoGiftView | null;
}

/** A line as stored: what was asked for. Volume, price and stock are resolved when it is read. */
export interface StoredLine {
  lineId: number;
  kind: LineKind;
  volumeId: number | null;
  fragranceIds: number[] | null;
  /** Which Discovery set a `discovery_set` line holds; null on the other kinds. */
  vialMl: DiscoveryVialMl | null;
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
  const rows = await tx
    .select({
      lineId: cartLines.id,
      kind: cartLines.kind,
      volumeId: cartLines.volumeId,
      fragranceIds: cartLines.fragranceIds,
      vialMl: cartLines.vialMl,
      qty: cartLines.qty,
    })
    .from(cartLines)
    .where(eq(cartLines.customerId, customerId))
    .orderBy(asc(cartLines.id));
  return rows.map((r) => ({
    ...r,
    vialMl: r.kind === 'discovery_set' ? asDiscoveryVialMl(r.vialMl) : null,
  }));
}

/** The cart's quote: `loadQuote` with the cart as the line source. */
export function loadCartQuote(
  tx: DbOrTx,
  now: Date,
  customerId: number,
  opts: { entitlements?: Entitlement[]; deliveryTariff?: number } = {},
): Promise<LoadedQuote> {
  return loadQuote(tx, now, customerId, { kind: 'cart' }, opts);
}

/**
 * Lines capped at available, priced through `quote()` (ADR 0001). The one place that turns stored
 * lines into a Quote: the cart screen, checkout (inside its transaction, after the stock rows are
 * locked) and «Купить сейчас» all come through here, so a line is judged and priced one way.
 * The customer's active Entitlements (a birthday coupon, #30) are loaded here for every source,
 * cart or not: without an entered code the server picks the one giving the lowest total (ADR
 * 0002), so «Купить сейчас» takes it too. The cart's entered promo code is judged here (the DB
 * checks, ticket #29) and `quote()` applies it or says why not; lines quoted on their own («Купить
 * сейчас») never carry it (spec Changes 2026-11-11). `deliveryTariff` is checkout's: the chosen BTS
 * point's region tariff, which wins over the saved delivery city's. `entitlements` replaces the
 * loaded ones (a test gives a source not built yet).
 */
export async function loadQuote(
  tx: DbOrTx,
  now: Date,
  customerId: number,
  source: LineSource,
  opts: { entitlements?: Entitlement[]; deliveryTariff?: number } = {},
): Promise<LoadedQuote> {
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
          })
          .from(volumes)
          .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
          // a 5 ml bottle is never sold alone (ADR 0042): a line naming one finds nothing
          .where(and(inArray(volumes.id, askedVolumes), sellableVolume()));
  const infoOf = new Map(volumeInfo.map((v) => [v.volumeId, v]));
  const rows = stored.flatMap((l) => {
    const v = l.kind === 'volume' && l.volumeId !== null ? infoOf.get(l.volumeId) : undefined;
    return v ? [{ ...v, lineId: l.lineId, qty: l.qty }] : [];
  });
  type Priced = { price: number; salePrice: number | null; saleEndsAt: Date | null };

  // Set lines (ADR 0009, 0042): each Discovery set from its own stock at its own price, a builder
  // set from each chosen 10 ml at the 5 × 10 ml set's price.
  const setRows = stored.filter((l) => l.kind !== 'volume');
  const discovery = new Map<DiscoveryVialMl, DiscoveryState>();
  const wantedSets = new Set<DiscoveryVialMl>(
    setRows.flatMap((r) => (r.kind === 'builder_set' ? [SET_VIAL_ML] : r.vialMl ? [r.vialMl] : [])),
  );
  for (const ml of [...wantedSets].sort((a, b) => a - b))
    discovery.set(ml, await loadDiscovery(tx, ml));
  const builderIds = [...new Set(setRows.flatMap((r) => r.fragranceIds ?? []))];
  const tenMlOfFragrance = new Map<number, TenMl>(
    builderIds.length === 0
      ? []
      : (await tenMlOf(tx, { ids: builderIds })).map((t) => [t.fragranceId, t]),
  );

  // What each fragrance's concentrate still has for the lines after the ones already placed, in
  // line order (ADR 0043): its volumes share one liquid, a 10 ml may sit in a volume line and in
  // builder sets of the same cart, and the last ml is sold once (ADR 0010). A line that no longer
  // fits is flagged like a sold-out one and takes nothing. A hidden fragrance is not for sale.
  const stock = await readLiquidStock(tx, [
    ...rows.map((r) => r.fragranceId),
    ...tenMlOfFragrance.keys(),
  ]);
  const hidden = new Set([
    ...rows.filter((r) => r.hidden).map((r) => r.fragranceId),
    ...[...tenMlOfFragrance.values()].filter((t) => t.hidden).map((t) => t.fragranceId),
  ]);
  const free = new Map<number, number>();
  const freeOf = (fragranceId: number) => {
    if (!free.has(fragranceId))
      free.set(fragranceId, hidden.has(fragranceId) ? 0 : stock.free(fragranceId));
    return free.get(fragranceId)!;
  };
  /** Whole bottles of `ml` a fragrance still fills for this line. */
  const left = (fragranceId: number, ml: number) => bottlesOf(freeOf(fragranceId), stock.fill(ml));
  const take = (fragranceIds: number[], ml: number, qty: number) => {
    for (const id of fragranceIds) free.set(id, freeOf(id) - qty * stock.fill(ml));
  };
  // each Discovery set's own stock, shared the same way (a cart holds one line of each, but
  // «Повторить заказ» weighs the old order's after it)
  const discoveryFree = new Map([...discovery].map(([ml, d]) => [ml, d.available]));

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
      const view = capped(r.qty, left(r.fragranceId, r.ml));
      if (!view.soldOut) take([r.fragranceId], r.ml, view.qty);
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
    const set = sr.kind === 'discovery_set' && sr.vialMl ? discovery.get(sr.vialMl) : undefined;
    if (set) {
      const left = discoveryFree.get(set.vialMl) ?? 0;
      const view = capped(sr.qty, left);
      if (!view.soldOut) discoveryFree.set(set.vialMl, left - view.qty);
      setLines.push({
        kind: 'discovery_set',
        vialMl: set.vialMl,
        lineId: sr.lineId,
        photo: set.row.photoHash,
        items: set.composition.map((f) => ({
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
        five.length === SET_SIZE
          ? Math.min(...five.map((t) => left(t.fragranceId, SET_VIAL_ML)))
          : 0,
      );
      const short = view.soldOut
        ? five
            .filter((t) => left(t.fragranceId, SET_VIAL_ML) <= 0)
            .map((t) => ({ slug: t.slug, name: t.name, inCart: t.available > 0 }))
        : [];
      if (!view.soldOut)
        take(
          five.map((t) => t.fragranceId),
          SET_VIAL_ML,
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

  const [cartState] =
    source.kind === 'cart'
      ? await tx.select().from(carts).where(eq(carts.customerId, customerId))
      : [];
  const city = await readDeliveryCity(tx, customerId);
  // the entered promo code lives on the cart: lines quoted on their own (buy-now) never see it
  const judged: JudgedPromoCode | null = cartState?.promoCode
    ? await judgePromoCode(tx, cartState.promoCode, customerId, now)
    : null;
  // A gift code's item takes what the cart's own lines leave of it (ADR 0039, 0010).
  const terms = judged?.promoCode ?? null;
  const promoGift =
    terms && !('refused' in terms) && terms.kind === 'gift'
      ? await loadPromoGift(tx, terms.promoGiftItem, {
          bottlesLeft: (fragranceId, ml) =>
            free.has(fragranceId) ? left(fragranceId, ml) : undefined,
          discovery: discovery.has(SET_VIAL_ML)
            ? { state: discovery.get(SET_VIAL_ML)!, left: discoveryFree.get(SET_VIAL_ML) ?? 0 }
            : null,
        })
      : null;
  const settings = await readSettings(tx, ['delivery.defaultTariff']);
  const quoteLines: QuoteLineInput[] = [
    ...volumeLines.map((l): QuoteLineInput => ({
      key: String(l.lineId),
      item: { kind: 'volume', fragranceId: l.fragranceId, volumeMl: l.ml },
      qty: l.qty,
      price: volumePrice(l),
      soldOut: l.soldOut,
    })),
    // a Discovery set costs its own price, a builder set the 5 × 10 ml one's; never marked down
    ...setLines.map((l): QuoteLineInput => ({
      key: String(l.lineId),
      item: { kind: 'set' },
      qty: l.qty,
      price: {
        regular: discovery.get(l.kind === 'discovery_set' ? l.vialMl : SET_VIAL_ML)?.row.price ?? 0,
        markdown: null,
      },
      soldOut: l.soldOut,
    })),
  ];
  quoteLines.sort((a, b) => Number(a.key) - Number(b.key));
  const entitlements = opts.entitlements ?? (await loadEntitlements(tx, customerId, now));
  const q = quote({
    lines: quoteLines,
    entitlements,
    promoCode: terms && withPromoGift(terms, promoGift),
    choice: cartState?.discountChoice ?? null,
    deliveryTariff:
      opts.deliveryTariff ?? city?.region.deliveryTariff ?? settings['delivery.defaultTariff'],
    settings: await readPricingSettings(tx),
    now,
  });
  return {
    lines,
    quote: q,
    cartState,
    city,
    promoCodeId: judged?.promoCodeId ?? null,
    entitlements,
    promoGift,
  };
}

/** The judged code as `quote()` takes it: a gift code with its item priced and its stock known. */
function withPromoGift(
  terms: PromoTerms | RefusedPromoCode,
  promoGift: PromoGiftView | null,
): PromoCode | RefusedPromoCode {
  if ('refused' in terms || terms.kind !== 'gift') return terms;
  if (!promoGift) throw new Error(`promo ${terms.code}: a gift code without its gift loaded`);
  const { promoGiftItem, ...rest } = terms;
  return {
    ...rest,
    promoGift: { item: promoGiftItem, regular: promoGift.regular, soldOut: promoGift.soldOut },
  };
}

/**
 * A gift code's item at its regular price (a markdown changes nothing: reports count the regular
 * price, ADR 0039), sold out when nothing is left of it once the cart's lines took theirs: a
 * fragrance the cart already fills from is what `bottlesLeft` says is left; the Discovery set
 * likewise when the cart holds it. A hidden fragrance is not for sale, so its gift is sold out too.
 */
async function loadPromoGift(
  tx: DbOrTx,
  item: PromoGiftItem,
  cart: {
    bottlesLeft: (fragranceId: number, ml: number) => number | undefined;
    discovery: { state: DiscoveryState; left: number } | null;
  },
): Promise<PromoGiftView> {
  if (item.kind === 'discovery_set') {
    // a gift code's set is the 5 × 10 ml one (ADR 0039)
    const state = cart.discovery?.state ?? (await loadDiscovery(tx, SET_VIAL_ML));
    const left = cart.discovery ? cart.discovery.left : state.available;
    return {
      kind: 'discovery_set',
      vialMl: SET_VIAL_ML,
      regular: state.row.price,
      soldOut: left < 1,
      photo: state.row.photoHash,
      items: state.composition.map((f) => ({
        fragranceId: f.id,
        slug: f.slug,
        name: f.name,
        brand: f.brand,
      })),
    };
  }
  const [v] = await tx
    .select({
      fragranceId: fragrances.id,
      slug: fragrances.slug,
      name: fragrances.name,
      brand: fragrances.originalBrand,
      hidden: fragrances.hidden,
      ml: volumes.ml,
      photo: volumes.photoHash,
      price: volumes.price,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(eq(volumes.id, item.volumeId));
  if (!v) throw new Error(`gift volume ${item.volumeId} is not in the catalog`);
  const left =
    cart.bottlesLeft(v.fragranceId, v.ml) ??
    (v.hidden ? 0 : (await readLiquidStock(tx, [v.fragranceId])).bottles(v.fragranceId, v.ml));
  return {
    kind: 'volume',
    volumeId: item.volumeId,
    fragranceId: v.fragranceId,
    slug: v.slug,
    name: v.name,
    brand: v.brand,
    ml: v.ml,
    photo: v.photo,
    regular: v.price,
    soldOut: left < 1,
  };
}

/** The gift line the cart and checkout list at 0, while the quote applies the gift code (ADR 0039). */
export function appliedPromoGift(
  q: Quote,
  promoGift: PromoGiftView | null,
): PromoGiftLineDto | null {
  return promoGiftOf(q.discount) && promoGift ? toPromoGiftDto(promoGift) : null;
}

/** The gift line the cart and checkout show under the lines, at 0 («Подарок по промокоду»). */
function toPromoGiftDto(g: PromoGiftView): PromoGiftLineDto {
  if (g.kind === 'discovery_set')
    return {
      kind: 'discovery_set',
      photo: g.photo,
      lineTotal: 0,
      fragrances: g.items.map(({ slug, name, brand }) => ({ slug, name, brand })),
    };
  return {
    kind: 'volume',
    photo: g.photo,
    lineTotal: 0,
    slug: g.slug,
    name: g.name,
    brand: g.brand,
    ml: g.ml as 10 | 30 | 50,
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
      return { ...base, kind: l.kind, vialMl: l.vialMl, fragrances: fragrancesOf(l.items) };
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

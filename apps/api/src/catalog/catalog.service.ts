import {
  PAID_STATUSES,
  type CatalogParams,
  type CatalogResult,
  type FragranceCard,
  type FragranceListItem,
  type VolumeCard,
} from '@lummi/contracts';
import {
  and,
  asc,
  desc,
  eq,
  families,
  fragranceNotes,
  fragranceSimilar,
  fragrances,
  inArray,
  sellableVolume,
  notes,
  orderEvents,
  orderLines,
  orders,
  volumes,
  type Db,
  type DbOrTx,
  type VolumeRow,
  RESERVING_STATUSES,
  sql,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { activeMarkdown, volumePrice } from '../pricing/quote';
import { stepUps } from '../pricing/step-up';
import { readPricingSettings } from '../pricing/pricing-settings';
import { upgradeRightPrices } from '../upgrade-rights/upgrade-rights';
import { readSettings } from '../settings/settings.service';
import { readCostSettings } from '../cost/cost-settings';
import { fillUl, type LiquidSettings } from '../cost/unit-cost';
import { DB, EDGES } from '../tokens';

/**
 * The bottles each order line holds, one row per line and volume (`order_id, position, volume_id,
 * qty`): a volume line (the gift sample and a promo gift too) its quantity of its volume, a builder
 * set line one 10 ml of each of its five fragrances per set (ADR 0009). The one definition of a
 * line's bottles: the Reserve sums their fills over orders not yet handed to BTS, and a status
 * change moves the concentrate by them (ADR 0010, 0043). The Discovery set has its own stock.
 */
export const lineVolumeUnits = sql`
  select ol.order_id, ol.position, ol.volume_id, ol.qty
  from order_lines ol
  where ol.kind = 'volume'
  union all
  select ol.order_id, ol.position, v.id, ol.qty
  from order_lines ol cross join lateral unnest(ol.set_volume_ids) as v(id)
  where ol.kind = 'builder_set'`;

/** `lineVolumeUnits` with each bottle's fragrance and ml: what a line fills from which concentrate. */
export const lineFills = sql`
  select u.order_id, u.position, v.fragrance_id, v.ml, u.qty
  from (${lineVolumeUnits}) u join volumes v on v.id = u.volume_id`;

/**
 * The Reserve per fragrance, µl (ADR 0010, 0043): the fills of the bottles (`lineFills`) of orders
 * neither handed to BTS nor cancelled (`RESERVING_STATUSES`), at the liquid settings given. This is
 * the one place that knows, so "available" is concentrate minus reserve everywhere: card, list,
 * cart, order creation, the panel.
 */
export async function reservedLiquid(
  db: DbOrTx,
  fragranceIds: readonly number[],
  liquid: LiquidSettings,
): Promise<Map<number, number>> {
  const out = new Map(fragranceIds.map((id) => [id, 0]));
  if (fragranceIds.length === 0) return out;
  const ids = sql.join(
    [...new Set(fragranceIds)].map((id) => sql`${id}`),
    sql`, `,
  );
  const statuses = sql.join(
    RESERVING_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const { rows } = await db.execute<{ fragrance_id: string; ml: number; qty: string }>(sql`
    select u.fragrance_id, u.ml, sum(u.qty) as qty
    from (${lineFills}) u join orders o on o.id = u.order_id
    where o.status in (${statuses}) and u.fragrance_id in (${ids})
    group by u.fragrance_id, u.ml`);
  for (const r of rows) {
    const id = Number(r.fragrance_id);
    out.set(id, (out.get(id) ?? 0) + Number(r.qty) * fillUl(Number(r.ml), liquid));
  }
  return out;
}

/** A fragrance's liquid as the shop judges it (ADR 0043), µl. */
export interface FragranceLiquid {
  concentrateUl: number;
  reservedUl: number;
}

/**
 * The fragrances' ready concentrate and its reserve, with the fill of each bottle size at the
 * liquid settings of now: the one read every availability goes through.
 */
export interface LiquidStock {
  liquid: LiquidSettings;
  /** One bottle's fill of `ml`, µl. */
  fill(ml: number): number;
  /** A fragrance's concentrate and reserve; none read: 0 and 0. */
  of(fragranceId: number): FragranceLiquid;
  /** Concentrate less reserve, never below zero, µl. */
  free(fragranceId: number): number;
  /** Whole bottles of `ml` the fragrance's free concentrate fills. */
  bottles(fragranceId: number, ml: number): number;
}

export async function readLiquidStock(
  db: DbOrTx,
  fragranceIds: readonly number[],
): Promise<LiquidStock> {
  const { liquid } = await readCostSettings(db);
  const ids = [...new Set(fragranceIds)];
  const [rows, reserved] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select({ id: fragrances.id, concentrateUl: fragrances.concentrateUl })
          .from(fragrances)
          .where(inArray(fragrances.id, ids)),
    reservedLiquid(db, ids, liquid),
  ]);
  const byId = new Map(
    rows.map((r) => [
      r.id,
      { concentrateUl: r.concentrateUl, reservedUl: reserved.get(r.id) ?? 0 },
    ]),
  );
  const of = (id: number) => byId.get(id) ?? { concentrateUl: 0, reservedUl: 0 };
  const fill = (ml: number) => fillUl(ml, liquid);
  const free = (id: number) => {
    const l = of(id);
    return available(l.concentrateUl, l.reservedUl);
  };
  return { liquid, fill, of, free, bottles: (id, ml) => bottlesOf(free(id), fill(ml)) };
}

/** Orders that still count as sold: paid, and neither cancelled nor returned. */
const SOLD_STATUSES = PAID_STATUSES.filter((s) => s !== 'returned');

/**
 * Paid orders per fragrance for the top-sales ranking: orders whose payment was confirmed since
 * `since` and that are still sold (not cancelled, not returned). A fragrance counts once per
 * order, bought as a bottle or picked into a builder set; the Discovery set's five are the
 * owner's choice, so its sales lift none of them, and neither does a gift code's free bottle. A Refund (#40) leaves an order's status alone
 * and is not looked at.
 */
export async function paidOrderCounts(db: DbOrTx, since: Date): Promise<Map<number, number>> {
  const sold = sql.join(
    SOLD_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const { rows } = await db.execute<{ fragrance_id: string; n: string }>(sql`
    select f.fragrance_id, count(distinct f.order_id) as n
    from (
      select l.order_id, l.fragrance_id
      from ${orderLines} l
      -- a gift code's free bottle was not bought (ADR 0039)
      where l.kind = 'volume' and l.fragrance_id is not null and not l.promo_gift
      union all
      select l.order_id, (pick->>'fragranceId')::bigint
      from ${orderLines} l cross join lateral jsonb_array_elements(l.set_composition) pick
      where l.kind = 'builder_set'
    ) f
    join ${orders} o on o.id = f.order_id
    where o.status in (${sold})
      and exists (
        select 1 from ${orderEvents} ev
        where ev.order_id = o.id and ev.action = 'confirm_payment'
          and ev.created_at >= ${since.toISOString()}::timestamptz
      )
    group by f.fragrance_id`);
  return new Map(rows.map((r) => [Number(r.fragrance_id), Number(r.n)]));
}

/** A visible fragrance as the list queries see it: card fields, filter fields and its volumes. */
interface CatalogEntry {
  id: number;
  slug: string;
  name: string;
  brand: string;
  type: FragranceListItem['type'];
  season: FragranceCard['season'];
  familyId: number | null;
  family: FragranceListItem['family'];
  keyNotes: FragranceListItem['keyNotes'];
  isHit: boolean;
  isNew: boolean;
  createdAt: Date;
  cards: VolumeCard[];
}

/** Nothing to buy: no volumes, or every one sold out. */
const soldOut = (cards: readonly VolumeCard[]) => !cards.some((c) => c.available > 0);

/**
 * THE lowest-price rule: the lowest effective price (a markdown counts while active, through
 * `toVolumeCard`) among the volumes with something available, or of the chosen volume. Null when
 * nothing is in stock. The card's from-price, the price filter and the price sorts all read this.
 */
function lowestPrice(cards: readonly VolumeCard[], volume?: number): number | null {
  const prices = cards
    .filter((c) => c.available > 0 && (volume === undefined || c.ml === volume))
    .map((c) => c.effectivePrice);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * THE from-volume: the volume the card's price and volume («69 000 сум · 10 мл») name (the lowest effective price among those
 * with something available). On a tie the marked-down one wins, so its struck regular price shows.
 */
function fromVolume(cards: readonly VolumeCard[]): VolumeCard | null {
  const from = lowestPrice(cards);
  if (from === null) return null;
  const tied = cards.filter((c) => c.available > 0 && c.effectivePrice === from);
  return tied.find((c) => c.salePrice !== null) ?? tied[0] ?? null;
}

/** The list photo: the 50 ml bottle, else the largest volume that has a photo. */
function listPhoto(cards: readonly VolumeCard[]): string | null {
  const withPhoto = cards.filter((c) => c.photo);
  const pick = withPhoto.find((c) => c.ml === 50) ?? withPhoto.sort((a, b) => b.ml - a.ml)[0];
  return pick?.photo ?? null;
}

function toListItem(e: CatalogEntry): FragranceListItem {
  const fv = fromVolume(e.cards);
  return {
    slug: e.slug,
    name: e.name,
    brand: e.brand,
    type: e.type,
    family: e.family,
    keyNotes: e.keyNotes,
    isHit: e.isHit,
    isNew: e.isNew,
    from: fv
      ? {
          price: fv.effectivePrice,
          ml: fv.ml,
          regularPrice: fv.salePrice !== null ? fv.price : null,
        }
      : null,
    soldOut: soldOut(e.cards),
    photo: listPhoto(e.cards),
    volumes: e.cards,
  };
}

/**
 * Available is on hand minus reserve, never below zero (ADR 0010): a Discovery set's boxes, a
 * fragrance's free concentrate in µl. The one place that says so.
 */
export const available = (onHand: number, reserved: number) => Math.max(0, onHand - reserved);

/** Whole bottles a free liquid fills (ADR 0043): the one place that says so. */
export const bottlesOf = (freeUl: number, fill: number) =>
  fill > 0 ? Math.floor(freeUl / fill) : 0;

/** On hand under the reserve (ADR 0010): allowed, and reported; the one place that says so. */
export const belowReserve = (onHand: number, reserved: number) => onHand < reserved;

/** What decides the number shown to customers (#83): the fragrance's own and the two settings. */
export interface ShownRule {
  /** `fragrances.shownCount`: null = the default. */
  own: number | null;
  /** Setting `stock.shownDefault`. */
  fallback: number;
  /** Setting `stock.shownMax`. */
  max: number;
}

/**
 * THE count a customer is shown («В наличии: N шт.», #83): the fragrance's own number (or the
 * default), never above the maximum and never above what the server can actually sell; 0 when
 * nothing is available, so a sold-out volume shows no count. The one place that says so.
 */
export function shownCount(availableNow: number, rule: ShownRule): number {
  if (availableNow <= 0) return 0;
  return Math.min(rule.own ?? rule.fallback, rule.max, availableNow);
}

/**
 * One volume as the card shows it, with the bottles its fragrance's free concentrate fills (ADR
 * 0043) and the count shown from them (#83). The markdown reverts by itself: it is judged against
 * `now`, no job.
 */
export function toVolumeCard(
  v: VolumeRow,
  bottles: number,
  now: Date,
  rule: ShownRule,
): VolumeCard {
  const sale = activeMarkdown(volumePrice(v), now);
  return {
    ml: v.ml as VolumeCard['ml'],
    price: v.price,
    salePrice: sale,
    salePercent: sale === null ? null : Math.round(((v.price - sale) / v.price) * 100),
    saleEndsAt: sale === null || v.saleEndsAt === null ? null : v.saleEndsAt.toISOString(),
    effectivePrice: sale ?? v.price,
    available: bottles,
    shown: shownCount(bottles, rule),
    photo: v.photoHash,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  /**
   * List cards for these fragrances, in the order of `ids` (hidden and unknown ones are skipped).
   * Search results, the catalog list and similar all come through one pass (`visibleEntries`), so
   * a list card is built in one place: the family pair, the lowest price and the sold-out flag.
   */
  async listItems(ids: readonly number[]): Promise<FragranceListItem[]> {
    if (ids.length === 0) return [];
    const byId = new Map((await this.visibleEntries(ids)).map((e) => [e.id, e]));
    return ids.flatMap((id) => {
      const e = byId.get(id);
      return e ? [toListItem(e)] : [];
    });
  }

  /**
   * Ids of every visible fragrance in «Популярное» order: owner-pinned (hit) first, then the paid
   * order count over `catalog.topSalesWindowDays` (`paidOrderCounts`), then newest. One
   * function, so Home, the catalog sort, the similar fallback and the cart suggestions agree.
   */
  async topSellersOrder(db: DbOrTx = this.db): Promise<number[]> {
    const [cfg, rows] = await Promise.all([
      readSettings(db, ['catalog.topSalesWindowDays']),
      db
        .select({ id: fragrances.id, isHit: fragrances.isHit, createdAt: fragrances.createdAt })
        .from(fragrances)
        .where(eq(fragrances.hidden, false))
        .orderBy(desc(fragrances.createdAt), desc(fragrances.id)),
    ]);
    const days = cfg['catalog.topSalesWindowDays'];
    const since = new Date(this.edges.clock.now().getTime() - days * 86_400_000);
    const sold = await paidOrderCounts(db, since);
    // `rows` is already newest first and the sort is stable, so equal keys keep that order.
    return [...rows]
      .sort(
        (a, b) =>
          Number(b.isHit) - Number(a.isHit) || (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0),
      )
      .map((r) => r.id);
  }

  /** Every visible fragrance (or just `ids`) with its volumes: one volumes -> reserve -> card pass. */
  private async visibleEntries(ids?: readonly number[]): Promise<CatalogEntry[]> {
    const only = ids ? [...ids] : undefined;
    const [rows, vols] = await Promise.all([
      this.db
        .select({
          id: fragrances.id,
          slug: fragrances.slug,
          name: fragrances.name,
          brand: fragrances.originalBrand,
          type: fragrances.type,
          season: fragrances.season,
          familyId: fragrances.familyId,
          keyNotesRu: fragrances.keyNotesRu,
          keyNotesUz: fragrances.keyNotesUz,
          isHit: fragrances.isHit,
          isNew: fragrances.isNew,
          shownCount: fragrances.shownCount,
          createdAt: fragrances.createdAt,
          familyRu: families.nameRu,
          familyUz: families.nameUz,
        })
        .from(fragrances)
        .leftJoin(families, eq(families.id, fragrances.familyId))
        .where(and(eq(fragrances.hidden, false), only ? inArray(fragrances.id, only) : undefined)),
      this.db
        .select()
        .from(volumes)
        // a 5 ml bottle is never sold alone (ADR 0042)
        .where(and(sellableVolume(), only ? inArray(volumes.fragranceId, only) : undefined))
        .orderBy(asc(volumes.ml)),
    ]);
    const stock = await readLiquidStock(
      this.db,
      rows.map((r) => r.id),
    );
    const now = this.edges.clock.now();
    const shownCfg = await readSettings(this.db, ['stock.shownDefault', 'stock.shownMax']);
    const ownOf = new Map(rows.map((r) => [r.id, r.shownCount]));
    const cardsOf = new Map<number, VolumeCard[]>();
    for (const v of vols)
      cardsOf.set(v.fragranceId, [
        ...(cardsOf.get(v.fragranceId) ?? []),
        toVolumeCard(v, stock.bottles(v.fragranceId, v.ml), now, {
          own: ownOf.get(v.fragranceId) ?? null,
          fallback: shownCfg['stock.shownDefault'],
          max: shownCfg['stock.shownMax'],
        }),
      ]);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      brand: r.brand,
      type: r.type,
      season: r.season,
      familyId: r.familyId,
      family: r.familyRu && r.familyUz ? { ru: r.familyRu, uz: r.familyUz } : null,
      keyNotes: { ru: r.keyNotesRu, uz: r.keyNotesUz },
      isHit: r.isHit,
      isNew: r.isNew,
      createdAt: r.createdAt,
      cards: cardsOf.get(r.id) ?? [],
    }));
  }

  /**
   * The catalog list. Filters combine with AND; `volume` keeps fragrances that have it in stock and
   * prices them by it. The page comes back as list cards (`listItems`), `total` counts every match.
   */
  async list(q: CatalogParams): Promise<CatalogResult> {
    const sort = q.sort;
    const [all, rank] = await Promise.all([this.visibleEntries(), this.topSellersOrder()]);
    const position = new Map(rank.map((id, i) => [id, i]));
    const rankOf = (e: CatalogEntry) => position.get(e.id) ?? Number.MAX_SAFE_INTEGER;
    const volume = q.volume;
    const price = (e: CatalogEntry) => lowestPrice(e.cards, volume);

    const kept = all.filter((e) => {
      if (q.type && e.type !== q.type) return false;
      if (q.family !== undefined && e.familyId !== q.family) return false;
      if (q.season && e.season !== q.season) return false;
      if (q.isNew && !e.isNew) return false;
      if (volume !== undefined && price(e) === null) return false;
      if (q.priceMin !== undefined || q.priceMax !== undefined) {
        const p = price(e);
        if (p === null) return false;
        if (q.priceMin !== undefined && p < q.priceMin) return false;
        if (q.priceMax !== undefined && p > q.priceMax) return false;
      }
      return true;
    });

    const byPrice = (dir: 1 | -1) => (a: CatalogEntry, b: CatalogEntry) => {
      const pa = price(a);
      const pb = price(b);
      if (pa === null || pb === null) return pa === pb ? 0 : pa === null ? 1 : -1; // sold out last
      return (pa - pb) * dir;
    };
    const compare: Record<typeof sort, (a: CatalogEntry, b: CatalogEntry) => number> = {
      top: () => 0,
      new: (a, b) =>
        Number(b.isNew) - Number(a.isNew) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id - a.id,
      price_asc: byPrice(1),
      price_desc: byPrice(-1),
    };
    // Ties of every sort fall back to the top-sales order, so a page boundary never reshuffles.
    const ordered = [...kept].sort((a, b) => compare[sort](a, b) || rankOf(a) - rankOf(b));

    const page = ordered.slice(q.offset, q.offset + q.limit);

    const facetRows = await this.db
      .select({ id: families.id, ru: families.nameRu, uz: families.nameUz })
      .from(families)
      .orderBy(asc(families.nameRu));
    const present = new Set(all.map((e) => e.familyId));
    const prices = all.flatMap((e) => {
      const p = lowestPrice(e.cards);
      return p === null ? [] : [p];
    });
    return {
      items: page.map(toListItem),
      total: kept.length,
      facets: {
        families: facetRows
          .filter((f) => present.has(f.id))
          .map((f) => ({ id: f.id, name: { ru: f.ru, uz: f.uz } })),
        price: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
      },
    };
  }

  /**
   * «Похожие ароматы»: the curated ones first (their own order), then the same family and type
   * in top-sales order; only what is in stock, up to `catalog.similarCount`. Hidden and unknown
   * slugs are `null`.
   */
  async similarTo(slug: string): Promise<FragranceListItem[] | null> {
    const [f] = await this.db
      .select({ id: fragrances.id, type: fragrances.type, familyId: fragrances.familyId })
      .from(fragrances)
      .where(and(eq(fragrances.slug, slug), eq(fragrances.hidden, false)));
    if (!f) return null;
    const [cfg, curated, all, rank] = await Promise.all([
      readSettings(this.db, ['catalog.similarCount']),
      this.db
        .select({ id: fragranceSimilar.similarId })
        .from(fragranceSimilar)
        .where(eq(fragranceSimilar.fragranceId, f.id))
        .orderBy(asc(fragranceSimilar.position)),
      this.visibleEntries(),
      this.topSellersOrder(),
    ]);
    const stocked = new Set(all.filter((e) => !soldOut(e.cards)).map((e) => e.id));
    const same = new Set(
      all
        .filter((e) => f.familyId !== null && e.familyId === f.familyId && e.type === f.type)
        .map((e) => e.id),
    );
    const ids = [...curated.map((c) => c.id), ...rank.filter((id) => same.has(id))].filter(
      (id, i, a) => id !== f.id && stocked.has(id) && a.indexOf(id) === i,
    );
    const byId = new Map(all.map((e) => [e.id, e]));
    return ids.slice(0, cfg['catalog.similarCount']).map((id) => toListItem(byId.get(id)!));
  }

  /**
   * A fragrance card as `customerId` sees it, with the prices their upgrade rights give (#38).
   * Hidden and unknown slugs are both `null`. Only customer-safe fields are selected.
   */
  async cardBySlug(slug: string, customerId: number): Promise<FragranceCard | null> {
    const [f] = await this.db
      .select({
        id: fragrances.id,
        slug: fragrances.slug,
        name: fragrances.name,
        brand: fragrances.originalBrand,
        type: fragrances.type,
        season: fragrances.season,
        timeOfDay: fragrances.timeOfDay,
        sillage: fragrances.sillage,
        longevityRu: fragrances.longevityRu,
        longevityUz: fragrances.longevityUz,
        descriptionRu: fragrances.descriptionRu,
        descriptionUz: fragrances.descriptionUz,
        whenToWearRu: fragrances.whenToWearRu,
        whenToWearUz: fragrances.whenToWearUz,
        keyNotesRu: fragrances.keyNotesRu,
        keyNotesUz: fragrances.keyNotesUz,
        uzumUrl: fragrances.uzumUrl,
        isHit: fragrances.isHit,
        isNew: fragrances.isNew,
        hidden: fragrances.hidden,
        shownCount: fragrances.shownCount,
        familyRu: families.nameRu,
        familyUz: families.nameUz,
      })
      .from(fragrances)
      .leftJoin(families, eq(families.id, fragrances.familyId))
      .where(eq(fragrances.slug, slug));
    if (!f || f.hidden) return null;

    const [noteRows, volumeRows] = await Promise.all([
      this.db
        .select({
          level: fragranceNotes.level,
          ru: notes.nameRu,
          uz: notes.nameUz,
        })
        .from(fragranceNotes)
        .innerJoin(notes, eq(notes.id, fragranceNotes.noteId))
        .where(eq(fragranceNotes.fragranceId, f.id))
        .orderBy(asc(fragranceNotes.position)),
      this.db
        .select()
        .from(volumes)
        .where(and(eq(volumes.fragranceId, f.id), sellableVolume()))
        .orderBy(asc(volumes.ml)),
    ]);
    const stock = await readLiquidStock(this.db, [f.id]);
    const now = this.edges.clock.now();
    const level = (l: 'top' | 'heart' | 'base') =>
      noteRows.filter((n) => n.level === l).map((n) => ({ ru: n.ru, uz: n.uz }));
    const [rights, pricing, step] = await Promise.all([
      upgradeRightPrices(this.db, customerId, f.id, volumeRows, now),
      readPricingSettings(this.db),
      readSettings(this.db, [
        'catalog.stepUp.enabled',
        'catalog.stepUp.minPercent',
        'catalog.showAvailableCount',
        'stock.shownDefault',
        'stock.shownMax',
      ]),
    ]);
    const rule: ShownRule = {
      own: f.shownCount,
      fallback: step['stock.shownDefault'],
      max: step['stock.shownMax'],
    };
    const cards = volumeRows.map((v) => toVolumeCard(v, stock.bottles(f.id, v.ml), now, rule));
    // no step-up onto or from a volume the customer's right prices: the tiles and the dock show
    // the right's price there, so «+N сум» would contradict them (the right's strip nudges then)
    const righted = new Set<number>(rights.map((r) => r.ml));
    const offers = step['catalog.stepUp.enabled']
      ? stepUps(cards, step['catalog.stepUp.minPercent']).filter(
          (u) => !righted.has(u.fromMl) && !righted.has(u.toMl),
        )
      : [];

    return {
      slug: f.slug,
      name: f.name,
      brand: f.brand,
      type: f.type,
      family: f.familyRu && f.familyUz ? { ru: f.familyRu, uz: f.familyUz } : null,
      season: f.season,
      timeOfDay: f.timeOfDay,
      sillage: f.sillage,
      longevity: { ru: f.longevityRu, uz: f.longevityUz },
      description: { ru: f.descriptionRu, uz: f.descriptionUz },
      whenToWear: { ru: f.whenToWearRu, uz: f.whenToWearUz },
      keyNotes: { ru: f.keyNotesRu, uz: f.keyNotesUz },
      notes: { top: level('top'), heart: level('heart'), base: level('base') },
      uzumUrl: f.uzumUrl,
      isHit: f.isHit,
      isNew: f.isNew,
      volumes: cards,
      upgradeRightPrices: rights,
      fullSizeMl: pricing.fullSizeVolumesMl,
      stepUps: offers,
      showAvailableCount: step['catalog.showAvailableCount'],
    };
  }
}

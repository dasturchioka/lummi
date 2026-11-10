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
import { activeMarkdown } from '../pricing/quote';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

/**
 * The 10/30/50 ml bottles each order line holds, one row per line and volume
 * (`order_id, position, volume_id, qty`): a volume line its quantity of its volume, a builder set
 * line one 10 ml of each of its five fragrances per set (ADR 0009). The one definition of a
 * line's bottles: the Reserve sums it over orders not yet handed to BTS, and a status change
 * moves on hand by it (ADR 0010). The Discovery set has its own stock and never touches 10 ml.
 */
export const lineVolumeUnits = sql`
  select ol.order_id, ol.position, ol.volume_id, ol.qty
  from order_lines ol
  where ol.kind = 'volume'
  union all
  select ol.order_id, ol.position, v.id, ol.qty
  from order_lines ol cross join lateral unnest(ol.set_volume_ids) as v(id)
  where ol.kind = 'builder_set'`;

/**
 * The Reserve per volume (ADR 0010): the bottles (`lineVolumeUnits`) of orders neither handed to
 * BTS nor cancelled (`RESERVING_STATUSES`). This is the one place that knows, so "available" is
 * on hand minus reserve everywhere: card, list, cart, order creation.
 */
export async function reservedByVolume(
  db: DbOrTx,
  volumeIds: number[],
): Promise<Map<number, number>> {
  const out = new Map(volumeIds.map((id) => [id, 0]));
  if (volumeIds.length === 0) return out;
  const ids = sql.join(
    volumeIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const statuses = sql.join(
    RESERVING_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const { rows } = await db.execute<{ volume_id: string; reserved: string }>(sql`
    select u.volume_id, sum(u.qty) as reserved
    from (${lineVolumeUnits}) u join orders o on o.id = u.order_id
    where o.status in (${statuses}) and u.volume_id in (${ids})
    group by u.volume_id`);
  for (const r of rows) out.set(Number(r.volume_id), Number(r.reserved));
  return out;
}

/** Orders that still count as sold: paid, and neither cancelled nor returned. */
const SOLD_STATUSES = PAID_STATUSES.filter((s) => s !== 'returned');

/**
 * Paid orders per fragrance for the top-sales ranking: orders whose payment was confirmed since
 * `since` and that are still sold (not cancelled, not returned). A fragrance counts once per
 * order, bought as a bottle or picked into a builder set; the Discovery set's five are the
 * owner's choice, so its sales lift none of them. A Refund (#40) leaves an order's status alone
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
      where l.kind = 'volume' and l.fragrance_id is not null
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
 * nothing is in stock. The card's «от …», the price filter and the price sorts all read this.
 */
function lowestPrice(cards: readonly VolumeCard[], volume?: number): number | null {
  const prices = cards
    .filter((c) => c.available > 0 && (volume === undefined || c.ml === volume))
    .map((c) => c.effectivePrice);
  return prices.length ? Math.min(...prices) : null;
}

function toListItem(e: CatalogEntry): FragranceListItem {
  return {
    slug: e.slug,
    name: e.name,
    brand: e.brand,
    type: e.type,
    family: e.family,
    keyNotes: e.keyNotes,
    isHit: e.isHit,
    isNew: e.isNew,
    fromPrice: lowestPrice(e.cards),
    soldOut: soldOut(e.cards),
    photo: e.cards[0]?.photo ?? null,
    volumes: e.cards,
  };
}

/** Available is on hand minus reserve, never below zero (ADR 0010): the one place that says so. */
export const available = (onHand: number, reserved: number) => Math.max(0, onHand - reserved);

/** One volume as the card shows it. The markdown reverts by itself: it is judged against `now`, no job. */
export function toVolumeCard(v: VolumeRow, reserved: number, now: Date): VolumeCard {
  const sale = activeMarkdown(
    {
      regular: v.price,
      markdown: v.salePrice === null ? null : { price: v.salePrice, endsAt: v.saleEndsAt },
    },
    now,
  );
  return {
    ml: v.ml as VolumeCard['ml'],
    price: v.price,
    salePrice: sale,
    salePercent: sale === null ? null : Math.round(((v.price - sale) / v.price) * 100),
    saleEndsAt: sale === null || v.saleEndsAt === null ? null : v.saleEndsAt.toISOString(),
    effectivePrice: sale ?? v.price,
    available: available(v.onHand, reserved),
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
        .where(only ? inArray(volumes.fragranceId, only) : undefined)
        .orderBy(asc(volumes.ml)),
    ]);
    const reserved = await reservedByVolume(
      this.db,
      vols.map((v) => v.id),
    );
    const now = this.edges.clock.now();
    const cardsOf = new Map<number, VolumeCard[]>();
    for (const v of vols)
      cardsOf.set(v.fragranceId, [
        ...(cardsOf.get(v.fragranceId) ?? []),
        toVolumeCard(v, reserved.get(v.id) ?? 0, now),
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
    const byId = new Map(all.map((e) => [e.id, e]));
    const photoOfTop = (type?: FragranceListItem['type']) => {
      for (const id of rank) {
        const e = byId.get(id);
        const photo = e && (!type || e.type === type) ? e.cards[0]?.photo : undefined;
        if (photo) return photo;
      }
      return null;
    };
    return {
      items: page.map(toListItem),
      total: kept.length,
      facets: {
        families: facetRows
          .filter((f) => present.has(f.id))
          .map((f) => ({ id: f.id, name: { ru: f.ru, uz: f.uz } })),
        price: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
        typePhotos: {
          all: photoOfTop(),
          homme: photoOfTop('homme'),
          femme: photoOfTop('femme'),
          unisex: photoOfTop('unisex'),
        },
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

  /** The card for a customer. Hidden and unknown slugs are both `null`. Only customer-safe fields are selected. */
  async cardBySlug(slug: string): Promise<FragranceCard | null> {
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
      this.db.select().from(volumes).where(eq(volumes.fragranceId, f.id)).orderBy(asc(volumes.ml)),
    ]);
    const reserved = await reservedByVolume(
      this.db,
      volumeRows.map((v) => v.id),
    );
    const now = this.edges.clock.now();
    const level = (l: 'top' | 'heart' | 'base') =>
      noteRows.filter((n) => n.level === l).map((n) => ({ ru: n.ru, uz: n.uz }));

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
      volumes: volumeRows.map((v) => toVolumeCard(v, reserved.get(v.id) ?? 0, now)),
    };
  }
}

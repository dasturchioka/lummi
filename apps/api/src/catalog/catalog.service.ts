import type { FragranceCard, FragranceListItem, VolumeCard } from '@lummi/contracts';
import {
  and,
  asc,
  desc,
  eq,
  families,
  fragranceNotes,
  fragrances,
  inArray,
  notes,
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
import { DB, EDGES } from '../tokens';

/**
 * The Reserve per volume (ADR 0010): units held by order lines whose order is neither handed to
 * BTS nor cancelled (`RESERVING_STATUSES`). A volume line holds its quantity; a builder set line
 * holds one 10 ml of each of its five fragrances per set unit (ADR 0009). The Discovery set has
 * its own stock and never touches 10 ml (#22 adds its reserve beside this). This is the one place
 * that knows, so "available" is on hand minus reserve everywhere: card, list, cart, order creation.
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
    select held.volume_id, sum(held.qty) as reserved
    from (
      select ol.volume_id, ol.qty
      from order_lines ol join orders o on o.id = ol.order_id
      where o.status in (${statuses}) and ol.volume_id in (${ids})
      union all
      select v.id, ol.qty
      from order_lines ol join orders o on o.id = ol.order_id
      cross join lateral unnest(ol.set_volume_ids) as v(id)
      where o.status in (${statuses}) and ol.kind = 'builder_set' and v.id in (${ids})
    ) held
    group by held.volume_id`);
  for (const r of rows) out.set(Number(r.volume_id), Number(r.reserved));
  return out;
}

/** Available is on hand minus reserve, never below zero (ADR 0010): the one place that says so. */
export const available = (onHand: number, reserved: number) => Math.max(0, onHand - reserved);

/**
 * "Top sellers" order, the one definition (spec §3.2, Changes 2026-11-10): owner-pinned (hit)
 * fragrances first, then the newest. Until orders exist there are no sales; #15 adds paid-order
 * counts over the window ahead of the newest tier, here, for every list that ranks by it.
 */
export const topSellersOrder = () => [desc(fragrances.isHit), desc(fragrances.id)];

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
   * Search results and, with #15, the catalog list come through here, so a list card is built in
   * one place: the family pair, the lowest price and the sold-out flag through `toVolumeCard`.
   */
  async listItems(ids: readonly number[]): Promise<FragranceListItem[]> {
    if (ids.length === 0) return [];
    const [rows, vols] = await Promise.all([
      this.db
        .select({
          id: fragrances.id,
          slug: fragrances.slug,
          name: fragrances.name,
          brand: fragrances.originalBrand,
          type: fragrances.type,
          keyNotesRu: fragrances.keyNotesRu,
          keyNotesUz: fragrances.keyNotesUz,
          isHit: fragrances.isHit,
          isNew: fragrances.isNew,
          familyRu: families.nameRu,
          familyUz: families.nameUz,
        })
        .from(fragrances)
        .leftJoin(families, eq(families.id, fragrances.familyId))
        .where(and(inArray(fragrances.id, [...ids]), eq(fragrances.hidden, false))),
      this.db
        .select()
        .from(volumes)
        .where(inArray(volumes.fragranceId, [...ids]))
        .orderBy(asc(volumes.ml)),
    ]);
    const reserved = await reservedByVolume(
      this.db,
      vols.map((v) => v.id),
    );
    const now = this.edges.clock.now();
    const volsOf = new Map<number, VolumeRow[]>();
    for (const v of vols) volsOf.set(v.fragranceId, [...(volsOf.get(v.fragranceId) ?? []), v]);
    const byId = new Map(rows.map((r) => [r.id, r]));

    return ids.flatMap((id) => {
      const f = byId.get(id);
      if (!f) return [];
      const cards = (volsOf.get(id) ?? []).map((v) =>
        toVolumeCard(v, reserved.get(v.id) ?? 0, now),
      );
      return [
        {
          slug: f.slug,
          name: f.name,
          brand: f.brand,
          type: f.type,
          family: f.familyRu && f.familyUz ? { ru: f.familyRu, uz: f.familyUz } : null,
          keyNotes: { ru: f.keyNotesRu, uz: f.keyNotesUz },
          isHit: f.isHit,
          isNew: f.isNew,
          fromPrice: cards.length ? Math.min(...cards.map((c) => c.effectivePrice)) : null,
          soldOut: cards.length === 0 || cards.every((c) => c.available === 0),
          photo: cards[0]?.photo ?? null,
        },
      ];
    });
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

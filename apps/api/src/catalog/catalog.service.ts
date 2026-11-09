import type { FragranceCard, FragranceListItem, VolumeCard } from '@lummi/contracts';
import {
  and,
  asc,
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
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { activeMarkdown } from '../pricing/quote';
import { DB, EDGES } from '../tokens';

/**
 * What is held back for orders not yet handed to BTS (ADR 0010). Order lines arrive with the
 * checkout ticket; until then nothing is reserved. Keep this the one place that knows, so
 * "available" is on hand minus reserve everywhere.
 */
export async function reservedByVolume(
  _db: DbOrTx,
  volumeIds: number[],
): Promise<Map<number, number>> {
  return new Map(volumeIds.map((id) => [id, 0]));
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

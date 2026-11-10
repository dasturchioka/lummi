import { SET_SIZE } from '@lummi/contracts/constants';
import {
  and,
  asc,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  inArray,
  volumes,
  type DbOrTx,
  type DiscoverySetRow,
} from '@lummi/db';
import { available, reservedByVolume } from '../catalog/catalog.service';

/**
 * What is held back of the Discovery set's own stock for orders not yet handed to BTS (ADR 0010).
 * Order lines arrive with the checkout ticket; until then nothing is reserved. Like
 * `reservedByVolume`, the one place that knows, so "available" is on hand minus reserve.
 */
export async function reservedDiscovery(_db: DbOrTx): Promise<number> {
  return 0;
}

/** The Discovery set row. The migration inserts it, so it always exists. */
export async function readDiscoverySet(db: DbOrTx, lock = false): Promise<DiscoverySetRow> {
  const q = db.select().from(discoverySet).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new Error('discovery_set row missing: run the migrations');
  return row;
}

export interface SetFragranceRow {
  id: number;
  slug: string;
  name: string;
  brand: string;
  keyNotesRu: string[];
  keyNotesUz: string[];
  hidden: boolean;
}

/** The Discovery set's composition in the owner's order. */
export async function readComposition(db: DbOrTx): Promise<SetFragranceRow[]> {
  return db
    .select({
      id: fragrances.id,
      slug: fragrances.slug,
      name: fragrances.name,
      brand: fragrances.originalBrand,
      keyNotesRu: fragrances.keyNotesRu,
      keyNotesUz: fragrances.keyNotesUz,
      hidden: fragrances.hidden,
    })
    .from(discoverySetItems)
    .innerJoin(fragrances, eq(fragrances.id, discoverySetItems.fragranceId))
    .orderBy(asc(discoverySetItems.position));
}

/**
 * The Discovery set's available count: its own on hand minus its own reserve, never touching 10 ml
 * stock (ADR 0009). A composition that is not yet five fragrances is not for sale.
 */
export function discoveryAvailable(
  row: DiscoverySetRow,
  reserved: number,
  composed: number,
): number {
  return composed === SET_SIZE ? available(row.onHand, reserved) : 0;
}

export interface TenMl {
  fragranceId: number;
  volumeId: number;
  slug: string;
  name: string;
  /** On hand minus reserve of the 10 ml; 0 for a hidden fragrance (not for sale). */
  available: number;
}

/** The 10 ml bottle of each fragrance (by id or slug) with what is available now. */
export async function tenMlOf(
  db: DbOrTx,
  by: { ids: readonly number[] } | { slugs: readonly string[] },
  lock = false,
): Promise<TenMl[]> {
  if (('ids' in by ? by.ids : by.slugs).length === 0) return [];
  const q = db
    .select({
      fragranceId: fragrances.id,
      volumeId: volumes.id,
      slug: fragrances.slug,
      name: fragrances.name,
      hidden: fragrances.hidden,
      onHand: volumes.onHand,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(
      and(
        eq(volumes.ml, 10),
        'ids' in by ? inArray(fragrances.id, [...by.ids]) : inArray(fragrances.slug, [...by.slugs]),
      ),
    )
    .orderBy(asc(volumes.id));
  const rows = await (lock ? q.for('update', { of: volumes }) : q);
  const reserved = await reservedByVolume(
    db,
    rows.map((r) => r.volumeId),
  );
  return rows.map((r) => ({
    fragranceId: r.fragranceId,
    volumeId: r.volumeId,
    slug: r.slug,
    name: r.name,
    available: r.hidden ? 0 : available(r.onHand, reserved.get(r.volumeId) ?? 0),
  }));
}

/** A builder set takes one 10 ml of each of its five: as many sets as the scarcest allows. */
export const builderAvailable = (tenMl: readonly { available: number }[]): number =>
  tenMl.length === SET_SIZE ? Math.min(...tenMl.map((t) => t.available)) : 0;

export type BuilderPick =
  | { ok: true; tenMl: TenMl[] }
  | { ok: false; reason: 'invalid' | 'not_found' }
  | { ok: false; reason: 'unavailable'; slugs: string[] };

/**
 * Judges a builder choice: exactly five different slugs, all existing and visible, each with a
 * 10 ml available. The order of `tenMl` follows `slugs`. The API checks this again on the
 * request's own transaction; the body schema already refuses a wrong count or a repeat.
 */
export function judgeBuilderPick(slugs: readonly string[], found: readonly TenMl[]): BuilderPick {
  if (slugs.length !== SET_SIZE || new Set(slugs).size !== SET_SIZE) {
    return { ok: false, reason: 'invalid' };
  }
  const bySlug = new Map(found.map((f) => [f.slug, f]));
  const picked = slugs.map((s) => bySlug.get(s));
  if (picked.some((p) => p === undefined)) return { ok: false, reason: 'not_found' };
  const all = picked as TenMl[];
  const gone = all.filter((p) => p.available === 0).map((p) => p.slug);
  if (gone.length > 0) return { ok: false, reason: 'unavailable', slugs: gone };
  return { ok: true, tenMl: all };
}

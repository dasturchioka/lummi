import {
  DISCOVERY_VIAL_MLS,
  SET_SIZE,
  SET_VIAL_ML,
  type DiscoveryVialMl,
} from '@lummi/contracts/constants';
import {
  and,
  asc,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  inArray,
  RESERVING_STATUSES,
  sql,
  volumes,
  type DbOrTx,
  type DiscoverySetRow,
} from '@lummi/db';
import { available, readLiquidStock } from '../catalog/catalog.service';

/**
 * What is held back of a Discovery set's own stock: the units on its lines (a Discovery line's `ml`
 * is its vial size, ADR 0042) of orders that are neither handed to BTS nor cancelled
 * (`RESERVING_STATUSES`, ADR 0010). Like `reservedLiquid` for the fragrances (ADR 0043), the one place that knows, so
 * "available" is on hand minus reserve.
 */
export async function reservedDiscovery(db: DbOrTx, vialMl: DiscoveryVialMl): Promise<number> {
  const statuses = sql.join(
    RESERVING_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const { rows } = await db.execute<{ reserved: string | null }>(sql`
    select sum(ol.qty) as reserved
    from order_lines ol join orders o on o.id = ol.order_id
    where o.status in (${statuses}) and ol.kind = 'discovery_set' and ol.ml = ${vialMl}`);
  return Number(rows[0]?.reserved ?? 0);
}

/** A Discovery set's row. The migrations insert both, so it always exists. */
export async function readDiscoverySet(
  db: DbOrTx,
  vialMl: DiscoveryVialMl,
  lock = false,
): Promise<DiscoverySetRow> {
  const q = db.select().from(discoverySet).where(eq(discoverySet.vialMl, vialMl));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new Error(`discovery_set ${vialMl} ml row missing: run the migrations`);
  return row;
}

/**
 * Locks the rows of the given Discovery sets `FOR UPDATE` in ascending vial ml, after the
 * fragrances (ADR 0043): the order every checkout, handover, Uzum sale and assembly takes them in,
 * so none waits on another. The rows as they are under the lock. The one place that takes it.
 */
export async function lockDiscoverySets(
  db: DbOrTx,
  vialMls: Iterable<DiscoveryVialMl>,
): Promise<Map<DiscoveryVialMl, DiscoverySetRow>> {
  const asked = [...vialMls];
  const wanted = DISCOVERY_VIAL_MLS.filter((ml) => asked.includes(ml)).sort((a, b) => a - b);
  const out = new Map<DiscoveryVialMl, DiscoverySetRow>();
  for (const ml of wanted) out.set(ml, await readDiscoverySet(db, ml, true));
  return out;
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

/** A Discovery set's composition in the owner's order. */
export async function readComposition(
  db: DbOrTx,
  vialMl: DiscoveryVialMl,
): Promise<SetFragranceRow[]> {
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
    .where(eq(discoverySetItems.vialMl, vialMl))
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

export interface DiscoveryState {
  vialMl: DiscoveryVialMl;
  row: DiscoverySetRow;
  composition: SetFragranceRow[];
  reserved: number;
  /** Own on hand minus own reserve; 0 while the composition is not five fragrances. */
  available: number;
}

/**
 * The one read of a Discovery set: row, composition, reserve and what is available. The shop,
 * the cart, the admin and (with `lock`) order creation all go through it, so "available" is
 * judged in one place.
 */
export async function loadDiscovery(
  db: DbOrTx,
  vialMl: DiscoveryVialMl,
  opts: { lock?: boolean } = {},
): Promise<DiscoveryState> {
  const row = await readDiscoverySet(db, vialMl, opts.lock);
  const [composition, reserved] = await Promise.all([
    readComposition(db, vialMl),
    reservedDiscovery(db, vialMl),
  ]);
  return {
    vialMl,
    row,
    composition,
    reserved,
    available: discoveryAvailable(row, reserved, composition.length),
  };
}

export interface TenMl {
  fragranceId: number;
  volumeId: number;
  slug: string;
  name: string;
  brand: string;
  /** Hidden from the catalog: not for sale and not offered to the builder. */
  hidden: boolean;
  /** The 10 ml fills its free concentrate makes (ADR 0043); 0 for a hidden fragrance (not for sale). */
  available: number;
}

/** The 10 ml bottle of each fragrance (by id or slug) with what is available now. */
export async function tenMlOf(
  db: DbOrTx,
  by: { ids: readonly number[] } | { slugs: readonly string[] } | { all: true },
): Promise<TenMl[]> {
  if (!('all' in by) && ('ids' in by ? by.ids : by.slugs).length === 0) return [];
  const q = db
    .select({
      fragranceId: fragrances.id,
      volumeId: volumes.id,
      slug: fragrances.slug,
      name: fragrances.name,
      brand: fragrances.originalBrand,
      hidden: fragrances.hidden,
    })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(
      and(
        eq(volumes.ml, SET_VIAL_ML),
        'all' in by
          ? undefined
          : 'ids' in by
            ? inArray(fragrances.id, [...by.ids])
            : inArray(fragrances.slug, [...by.slugs]),
      ),
    )
    .orderBy(asc(volumes.id));
  const rows = await q;
  const stock = await readLiquidStock(
    db,
    rows.map((r) => r.fragranceId),
  );
  return rows.map((r) => ({
    ...r,
    available: r.hidden ? 0 : stock.bottles(r.fragranceId, SET_VIAL_ML),
  }));
}

/** A builder set takes one 10 ml fill of each of its five: as many sets as the scarcest allows. */
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
  // a hidden fragrance answers like an unknown one: the builder never confirms it exists
  const bySlug = new Map(found.filter((f) => !f.hidden).map((f) => [f.slug, f]));
  const picked = slugs.map((s) => bySlug.get(s));
  if (picked.some((p) => p === undefined)) return { ok: false, reason: 'not_found' };
  const all = picked as TenMl[];
  const gone = all.filter((p) => p.available === 0).map((p) => p.slug);
  if (gone.length > 0) return { ok: false, reason: 'unavailable', slugs: gone };
  return { ok: true, tenMl: all };
}

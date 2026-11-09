import {
  eq,
  families,
  fragranceNotes,
  fragranceSearch,
  fragrances,
  inArray,
  notes,
  sql,
  type DbOrTx,
} from '@lummi/db';
import { skeleton } from './normalize';

/**
 * The search document of a fragrance (ADR 0019): name, aliases, original brand, notes RU/UZ and
 * family RU/UZ, each reduced to the Latin skeleton. Whoever changes a fragrance, its notes or
 * its family calls `reindexFragrances` in the same transaction (the seed does; the admin catalog
 * ticket must), so the document never lags. `syncSearchIndex` is the safety net at API start.
 */
export async function reindexFragrances(db: DbOrTx, ids?: readonly number[]): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const rows = await db
    .select({
      id: fragrances.id,
      name: fragrances.name,
      brand: fragrances.originalBrand,
      aliases: fragrances.aliases,
      changedAt: fragrances.updatedAt,
      familyRu: families.nameRu,
      familyUz: families.nameUz,
      familyAliases: families.aliases,
    })
    .from(fragrances)
    .leftJoin(families, eq(families.id, fragrances.familyId))
    .where(ids ? inArray(fragrances.id, [...ids]) : undefined);
  if (rows.length === 0) return 0;

  const noteRows = await db
    .select({
      fragranceId: fragranceNotes.fragranceId,
      ru: notes.nameRu,
      uz: notes.nameUz,
      aliases: notes.aliases,
    })
    .from(fragranceNotes)
    .innerJoin(notes, eq(notes.id, fragranceNotes.noteId))
    .where(inArray(fragranceNotes.fragranceId, ids ? [...ids] : rows.map((r) => r.id)));
  const notesOf = new Map<number, string[]>();
  for (const n of noteRows) {
    const list = notesOf.get(n.fragranceId) ?? [];
    list.push(n.ru, n.uz, ...n.aliases);
    notesOf.set(n.fragranceId, list);
  }

  const values = rows.map((r) => ({
    fragranceId: r.id,
    name: skeleton(r.name),
    aliases: r.aliases.map(skeleton).filter(Boolean),
    brand: skeleton(r.brand),
    notes: skeleton((notesOf.get(r.id) ?? []).join(' ')),
    family: skeleton([r.familyRu ?? '', r.familyUz ?? '', ...(r.familyAliases ?? [])].join(' ')),
    // The document carries its fragrance's timestamp: older than the fragrance means stale.
    updatedAt: r.changedAt,
  }));
  // Batches keep the statement under the driver's parameter limit when the catalog grows.
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(fragranceSearch)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: fragranceSearch.fragranceId,
        set: {
          name: sql`excluded.name`,
          aliases: sql`excluded.aliases`,
          brand: sql`excluded.brand`,
          notes: sql`excluded.notes`,
          family: sql`excluded.family`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return values.length;
}

/** Rebuilds the documents that are missing or older than their fragrance. Returns how many. */
export async function syncSearchIndex(db: DbOrTx): Promise<number> {
  const stale = await db
    .select({ id: fragrances.id })
    .from(fragrances)
    .leftJoin(fragranceSearch, eq(fragranceSearch.fragranceId, fragrances.id))
    .where(
      sql`${fragranceSearch.fragranceId} is null or ${fragranceSearch.updatedAt} < ${fragrances.updatedAt}`,
    );
  return reindexFragrances(
    db,
    stale.map((s) => s.id),
  );
}

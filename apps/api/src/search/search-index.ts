import {
  eq,
  families,
  fragranceNotes,
  fragranceSearch,
  fragrances,
  inArray,
  notes,
  sql,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { skeleton, skeletonOf } from './normalize';

/** One advisory lock serialises every index write, so two writers never interleave their documents. */
const INDEX_LOCK = 7_160_016;

interface Doc {
  fragranceId: number;
  name: string;
  aliases: string[];
  brand: string;
  notes: string;
  family: string;
  keyNotes: string;
}

async function buildDocs(db: DbOrTx, ids?: readonly number[]): Promise<Doc[]> {
  const rows = await db
    .select({
      id: fragrances.id,
      name: fragrances.name,
      brand: fragrances.originalBrand,
      aliases: fragrances.aliases,
      familyRu: families.nameRu,
      familyUz: families.nameUz,
      familyAliases: families.aliases,
      keyNotesRu: fragrances.keyNotesRu,
      keyNotesUz: fragrances.keyNotesUz,
    })
    .from(fragrances)
    .leftJoin(families, eq(families.id, fragrances.familyId))
    .where(ids ? inArray(fragrances.id, [...ids]) : undefined);
  if (rows.length === 0) return [];

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

  return rows.map((r) => ({
    fragranceId: r.id,
    name: skeleton(r.name),
    aliases: r.aliases.map(skeleton).filter(Boolean),
    brand: skeleton(r.brand),
    // Sorted: the join returns rows in no fixed order, and an unstable text would look changed.
    notes: skeletonOf((notesOf.get(r.id) ?? []).sort()),
    keyNotes: skeletonOf([...r.keyNotesRu, ...r.keyNotesUz]),
    family: skeletonOf([r.familyRu ?? '', r.familyUz ?? '', ...(r.familyAliases ?? [])]),
  }));
}

const same = (a: Doc, b: typeof fragranceSearch.$inferSelect): boolean =>
  a.name === b.name &&
  a.brand === b.brand &&
  a.notes === b.notes &&
  a.family === b.family &&
  a.keyNotes === b.keyNotes &&
  a.aliases.length === b.aliases.length &&
  a.aliases.every((x, i) => x === b.aliases[i]);

/**
 * The search document of a fragrance (ADR 0019): name, aliases, original brand, notes RU/UZ and
 * family RU/UZ, each reduced to the Latin skeleton.
 *
 * THE seam for keeping it current: whoever changes a fragrance, its notes, its families or their
 * aliases calls `reindexFragrances(tx, ids?)` inside the same transaction (the seed does; the
 * admin catalog ticket must on every content change). Without `ids` it rebuilds all of them.
 * It takes the index lock first and reads the content after that, so a writer that waits sees
 * the other's committed content; it only writes documents whose text differs, and its upsert
 * cannot replace a document stamped later than this build. Returns how many it wrote.
 */
export async function reindexFragrances(tx: DbOrTx, ids?: readonly number[]): Promise<number> {
  if (ids && ids.length === 0) return 0;
  await tx.execute(sql`select pg_advisory_xact_lock(${INDEX_LOCK})`);
  const docs = await buildDocs(tx, ids);
  if (docs.length === 0) return 0;
  const existing = new Map(
    (
      await tx
        .select()
        .from(fragranceSearch)
        .where(
          inArray(fragranceSearch.fragranceId, ids ? [...ids] : docs.map((d) => d.fragranceId)),
        )
    ).map((d) => [d.fragranceId, d]),
  );
  const changed = docs.filter((d) => {
    const old = existing.get(d.fragranceId);
    return !old || !same(d, old);
  });
  if (changed.length === 0) return 0;
  const stamp = (await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`)).rows[0]!
    .now;
  // Batches keep the statement under the driver's parameter limit when the catalog grows.
  for (let i = 0; i < changed.length; i += 500) {
    await tx
      .insert(fragranceSearch)
      .values(changed.slice(i, i + 500).map((d) => ({ ...d, updatedAt: new Date(stamp) })))
      .onConflictDoUpdate({
        target: fragranceSearch.fragranceId,
        set: {
          name: sql`excluded.name`,
          aliases: sql`excluded.aliases`,
          brand: sql`excluded.brand`,
          notes: sql`excluded.notes`,
          family: sql`excluded.family`,
          keyNotes: sql`excluded.key_notes`,
          updatedAt: sql`excluded.updated_at`,
        },
        // Never replace a document stamped later than this build.
        setWhere: sql`${fragranceSearch.updatedAt} <= excluded.updated_at`,
      });
  }
  return changed.length;
}

/**
 * The safety net at API start (not in the worker): rebuilds every document whose computed text
 * differs from the stored one, in one transaction under the index lock. With a catalog this size
 * the full pass is cheap, and it catches renamed notes and families, which no timestamp shows.
 */
export async function syncSearchIndex(db: Db): Promise<number> {
  return db.transaction((tx) => reindexFragrances(tx));
}

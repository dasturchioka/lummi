import { fragrances, sql, type Db } from '@lummi/db';

/**
 * Staging's first-deploy seed: load the catalog only into an empty catalog. `seedCatalog` itself is
 * idempotent but rewrites fragrance text in place, which would undo edits made in the admin panel
 * between two deploys. Returns true when it seeded.
 */
export async function seedCatalogIfEmpty(db: Db, seed: () => Promise<unknown>): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(fragrances);
  if ((row?.n ?? 0) > 0) return false;
  await seed();
  return true;
}

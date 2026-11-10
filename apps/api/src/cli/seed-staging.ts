import { createDb } from '@lummi/db';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importBtsPoints, type Snapshot } from '../bts/import-points';
import { seedCatalog } from '../catalog/seed';
import { seedCatalogIfEmpty } from '../catalog/seed-if-empty';
import { LocalFileStore } from '../edges';

/**
 * The deploy's seed step, safe to run on every deploy: seed data only, never overwrites.
 *   - catalog (67 fragrances, placeholder prices, photos): only while the catalog is empty;
 *   - BTS pickup points: adds missing codes, never touches existing rows.
 * Content texts are seeded by the API at start. Needs DATABASE_URL and FILES_DIR.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url, 1);
try {
  const seeded = await seedCatalogIfEmpty(db, () =>
    seedCatalog(db, {
      materialsDir: fileURLToPath(new URL('../../../../materials', import.meta.url)),
      photos: new LocalFileStore(process.env.FILES_DIR ?? './media'),
    }),
  );
  console.log(seeded ? 'catalog: seeded' : 'catalog: already has data, left as it is');
  const snapshot = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../bts/bts-points.snapshot.json'), 'utf8'),
  ) as Snapshot;
  const r = await importBtsPoints(db, snapshot);
  console.log(`BTS points: ${r.inserted} added, ${r.updated} updated, ${r.unchanged} unchanged`);
} finally {
  await pool.end();
}

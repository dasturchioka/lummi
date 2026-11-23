import { createDb } from '@lummi/db';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importBtsPoints, type Snapshot } from '../bts/import-points';
import { seedCatalog } from '../catalog/seed';
import { seedOilPrices } from '../catalog/seed-oil-prices';
import { seedCatalogIfEmpty } from '../catalog/seed-if-empty';
import { freezeMissingOrderCosts } from '../cost/freeze-order-costs';
import { LocalFileStore } from '../edges';

/**
 * The deploy's seed step, safe to run on every deploy: seed data only, never overwrites.
 *   - catalog (82 fragrances, placeholder prices, photos): all of it while the catalog is empty,
 *     afterwards only the seed's fragrances whose code it lacks (existing rows never touched);
 *   - oil prices and tiers from the file at OIL_PRICES_FILE (#75, kept off the repository): only
 *     where a fragrance has none; skipped without the variable or the file;
 *   - BTS pickup points: adds missing codes, never touches existing rows;
 *   - order costs (#77): orders paid before costs were recorded get their cost snapshot, once
 *     every line has an oil price; a frozen snapshot is never touched.
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
  if (seeded) console.log('catalog: seeded');
  else {
    // fragrances added to the seed later (068–082): only codes the catalog lacks, nothing else touched
    const added = await seedCatalog(db, {
      materialsDir: fileURLToPath(new URL('../../../../materials', import.meta.url)),
      photos: new LocalFileStore(process.env.FILES_DIR ?? './media'),
      onlyMissing: true,
    });
    console.log(
      `catalog: already has data; ${added.fragrances} new fragrances from the seed added`,
    );
  }
  // the cost model (#75): oil prices from OIL_PRICES_FILE where still empty, never overwritten
  await seedOilPrices(db);
  const snapshot = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../bts/bts-points.snapshot.json'), 'utf8'),
  ) as Snapshot;
  const r = await importBtsPoints(db, snapshot);
  console.log(`BTS points: ${r.inserted} added, ${r.updated} updated, ${r.unchanged} unchanged`);
  // after the oil prices, so an order waiting for one gets its costs as soon as it is there
  const costs = await freezeMissingOrderCosts(db, new Date());
  console.log(
    `order costs: ${costs.frozen} frozen, ${costs.waiting} waiting for an oil price` +
      (costs.uncostable.length
        ? `, without a cost for good (a line with nothing to cost): № ${costs.uncostable.join(', ')}`
        : ''),
  );
} finally {
  await pool.end();
}

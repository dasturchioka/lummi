import { createDb } from '@lummi/db';
import { fileURLToPath } from 'node:url';
import { LocalFileStore } from '../edges';
import { seedCatalog } from '../catalog/seed';
import { seedOilPrices } from '../catalog/seed-oil-prices';

/**
 * Seed the 67-fragrance catalog with placeholder prices and stock, photos included:
 *   npm run seed:catalog -w @lummi/api
 * Idempotent. Needs DATABASE_URL and FILES_DIR (like the API). Reads `materials/`, and the oil
 * prices from OIL_PRICES_FILE when it is set (kept off the repository, #75).
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url, 1);
try {
  const materialsDir = fileURLToPath(new URL('../../../../materials', import.meta.url));
  const result = await seedCatalog(db, {
    materialsDir,
    photos: new LocalFileStore(process.env.FILES_DIR ?? './media'),
  });
  console.log(`Catalog seeded: ${result.fragrances} fragrances (placeholder prices and stock).`);
  await seedOilPrices(db); // OIL_PRICES_FILE, where a fragrance has none (#75)
} finally {
  await pool.end();
}

import { createDb } from '@lummi/db';
import { fileURLToPath } from 'node:url';
import { LocalFileStore } from '../edges';
import { seedCatalog } from '../catalog/seed';

/**
 * Seed the 67-fragrance catalog with placeholder prices and stock, photos included:
 *   npm run seed:catalog -w @lummi/api
 * Idempotent. Needs DATABASE_URL and FILES_DIR (like the API). Reads `materials/` only.
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
} finally {
  await pool.end();
}

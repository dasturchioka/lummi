import { createDb } from '@lummi/db';
import { SystemClock } from '../edges';
import { seedOwner } from '../staff/seed-owner';
import { parseSeedOwnerArgs } from './seed-owner-args';

/**
 * Seed (or re-activate) the first owner:
 *   npm run seed:owner -w @lummi/api -- --telegram-id 123456789 --name "Fayzali"
 * Idempotent. Needs DATABASE_URL (from .env / .env.local like the API).
 */
const args = parseSeedOwnerArgs(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url, 1);
try {
  const row = await seedOwner(db, new SystemClock().now(), args);
  console.log(`Owner ready: ${row.name} (telegram id ${row.telegramId}, staff id ${row.id})`);
} finally {
  await pool.end();
}

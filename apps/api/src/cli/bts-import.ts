import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb } from '@lummi/db';
import { importBtsPoints, type Snapshot } from '../bts/import-points';

/**
 * Load the committed bts.uz snapshot into the database:
 *   npm run bts:import -w @lummi/api            # adds points that are not there yet
 *   npm run bts:import -w @lummi/api -- --refresh   # also rewrites BTS-published fields of existing ones
 * Idempotent by code; never touches `active`. Needs DATABASE_URL (from .env / .env.local).
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;
const { db, pool } = createDb(url, 1);
try {
  const r = await importBtsPoints(db, snapshot, { refresh: process.argv.includes('--refresh') });
  console.log(`BTS points: ${r.inserted} added, ${r.updated} updated, ${r.unchanged} unchanged`);
} finally {
  await pool.end();
}

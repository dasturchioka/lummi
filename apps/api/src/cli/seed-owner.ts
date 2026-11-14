import { createDb } from '@lummi/db';
import { SystemClock } from '../edges';
import { seedOwner } from '../staff/seed-owner';
import { parseSeedOwnerArgs } from './seed-owner-args';

/**
 * Seed (or re-activate) an owner, by login and/or Telegram id:
 *   npm run seed:owner -w @lummi/api -- --login fayzali --name "Fayzali" [--telegram-id 123456789]
 * Idempotent. To add a login to an owner seeded by Telegram id, pass that same --telegram-id.
 * Needs DATABASE_URL (from .env / .env.local like the API). The password comes from
 * `set-owner-password`.
 */
const args = parseSeedOwnerArgs(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url, 1);
try {
  const row = await seedOwner(db, new SystemClock().now(), args);
  const ways = [
    row.login ? `login ${row.login}` : null,
    row.telegramId ? `telegram id ${row.telegramId}` : null,
  ].filter(Boolean);
  console.log(`Owner ready: ${row.name} (${ways.join(', ')}, staff id ${row.id})`);
  if (row.login && !row.passwordHash) {
    console.log(`No password yet: run set-owner-password --login ${row.login}`);
  }
} finally {
  await pool.end();
}

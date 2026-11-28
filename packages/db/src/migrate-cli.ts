import { migrateDb } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
await migrateDb(url);
console.log('migrations applied');

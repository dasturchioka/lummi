import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies the migrations not yet applied; `folder` is another copy of them (a test cuts it short). */
export async function migrateDb(connectionString: string, folder = migrationsFolder): Promise<void> {
  const { db, pool } = createDb(connectionString, 1);
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function migrateDb(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString, 1);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

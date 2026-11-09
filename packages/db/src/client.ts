import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Either the db or a transaction handle; services accept this so callers choose the boundary. */
export type DbOrTx = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export function createDb(connectionString: string, max = 5): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString, max });
  return { db: drizzle(pool, { schema }), pool };
}

import { migrateDb } from '@lummi/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin connection string of the shared test Postgres (database `postgres`). */
    pgAdminUrl: string;
    /** Name of the migrated template database each test file clones. */
    templateDb: string;
  }
}

const TEMPLATE = 'lummi_template';
let container: StartedPostgreSqlContainer | undefined;

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * One Postgres per test run, shared by every integration file. TEST_DATABASE_URL points at an
 * already running server instead (saves the container; see docs/dev.md).
 */
export default async function setup(project: TestProject) {
  let adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withCommand([
        'postgres',
        '-c',
        'fsync=off',
        '-c',
        'shared_buffers=32MB',
        '-c',
        'max_connections=100',
      ])
      .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
      .start();
    adminUrl = withDb(container.getConnectionUri(), 'postgres');
  }

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEMPLATE}`);
  await admin.end();
  await migrateDb(withDb(adminUrl, TEMPLATE));

  project.provide('pgAdminUrl', adminUrl);
  project.provide('templateDb', TEMPLATE);

  return async () => {
    if (container) await container.stop();
    else {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
      await c.end();
    }
  };
}

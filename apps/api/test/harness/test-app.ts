import { createDb, type Db } from '@lummi/db';
import type { INestApplication } from '@nestjs/common';
import { initClient } from '@ts-rest/core';
import { contract } from '@lummi/contracts';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../src/app';
import { WorkerRuntime } from '../../src/worker/runtime';
import { parseEnv, type Env } from '../../src/env';
import { createFakeEdges, type FakeEdges } from '../fakes';
import { DEFAULT_TEST_USER, signInitData, type TestUser } from './sign-init-data';

export const TEST_BOT_TOKEN = '123456:TEST-bot-token-for-unit-tests';

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret';
export const TEST_MINIAPP_URL = 'https://miniapp.test.invalid/';

export interface TestApp {
  baseUrl: string;
  db: Db;
  env: Env;
  edges: FakeEdges;
  /** Typed ts-rest client; pass `token` for authenticated calls. */
  client: ReturnType<typeof makeClient>;
  /** Signed initData for a test user, "now" per the fake clock unless overridden. */
  initData(user?: TestUser, overrides?: { authDate?: number }): string;
  /** Sign in as a test user and return the session and a client bound to it. */
  signIn(user?: TestUser): Promise<{ token: string; client: ReturnType<typeof makeClient> }>;
  /** POST a raw Telegram update to the webhook route. */
  postUpdate(update: object, secret?: string): Promise<Response>;
  /** A worker over this app's db and edges, with its own queue; closed by `close()`. Delivery is started. */
  startWorker(): WorkerRuntime;
  /** Per-test isolation: empties every table (identity restarted). Call in beforeEach. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

function makeClient(baseUrl: string, token?: string) {
  return initClient(contract, {
    baseUrl,
    baseHeaders: token ? { authorization: `Bearer ${token}` } : {},
    throwOnUnknownStatus: true,
  });
}

/**
 * Seam 1 (ADR 0028): the real API in process over HTTP, a real Postgres, the four edges faked.
 * Each call clones a private database from the migrated template of the shared test Postgres,
 * so test files can run in parallel without seeing each other's rows.
 */
export async function createTestApp(): Promise<TestApp> {
  const adminUrl = inject('pgAdminUrl');
  const template = inject('templateDb');
  const dbName = `t_${randomUUID().replace(/-/g, '')}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName} TEMPLATE ${template}`);
  await admin.end();

  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;
  const env = parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: dbUrl.toString(),
    BOT_TOKEN: TEST_BOT_TOKEN,
    SESSION_SECRET: 'test-session-secret-test-session-secret',
    WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    MINIAPP_URL: TEST_MINIAPP_URL,
    REDIS_URL: inject('redisUrl'),
  });
  const { db, pool } = createDb(env.DATABASE_URL, 3);
  const edges = createFakeEdges();
  const app: INestApplication = await createApp({
    env,
    db,
    edges,
    botInfo: {
      id: 123456,
      is_bot: true,
      first_name: 'Test',
      username: 'lummi_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
      allows_users_to_create_topics: false,
    },
  });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  const initData: TestApp['initData'] = (user = DEFAULT_TEST_USER, overrides = {}) =>
    signInitData({
      botToken: TEST_BOT_TOKEN,
      user,
      authDate: overrides.authDate ?? Math.floor(edges.clock.now().getTime() / 1000),
    });

  const client = makeClient(baseUrl);
  const workers: WorkerRuntime[] = [];
  return {
    baseUrl,
    db,
    env,
    edges,
    client,
    initData,
    postUpdate(update, secret = TEST_WEBHOOK_SECRET) {
      return fetch(`${baseUrl}/telegram/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
        body: JSON.stringify(update),
      });
    },
    startWorker() {
      const w = new WorkerRuntime({
        env,
        db,
        edges,
        queueName: `q_${dbName}`,
        log: () => undefined,
      });
      w.start();
      workers.push(w);
      return w;
    },
    async signIn(user) {
      const res = await client.auth.telegram({ body: { initData: initData(user) } });
      if (res.status !== 200) throw new Error(`test sign-in failed: ${res.status}`);
      return { token: res.body.token, client: makeClient(baseUrl, res.body.token) };
    },
    async reset() {
      const { rows } = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_%'`,
      );
      const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
      if (tables) await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    },
    async close() {
      for (const w of workers) await w.close();
      await app.close();
      await pool.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

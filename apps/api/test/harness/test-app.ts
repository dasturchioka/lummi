import { createDb, shopCard, staff, type Db, type StaffRole, type StaffRow } from '@lummi/db';
import type { INestApplication } from '@nestjs/common';
import { initClient } from '@ts-rest/core';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { apiContract } from '@lummi/contracts';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { seedRegions } from '../../src/bts/seed-regions';
import { createApp } from '../../src/app';
import { WorkerRuntime } from '../../src/worker/runtime';
import { parseEnv, type Env } from '../../src/env';
import { createFakeEdges, type FakeEdges } from '../fakes';
import { signLoginWidget, type WidgetUser } from './sign-login-widget';
import { DEFAULT_TEST_USER, signInitData, type TestUser } from './sign-init-data';

export const TEST_BOT_TOKEN = '123456:TEST-bot-token-for-unit-tests';

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret';
export const TEST_MINIAPP_URL = 'https://miniapp.test.invalid/';
/** Shared secret of the internal endpoints the userbot calls (ADR 0031). */
export const TEST_INTERNAL_SECRET = 'test-internal-secret-test-internal-secret';

/** The shop card every test starts with: checkout is closed while none is set (#28). */
export const TEST_SHOP_CARD = { number: '9860123456781234', holder: 'LUMMI TEST' } as const;

/** Reference data, like the regions: tests about a missing card remove it themselves. */
async function seedShopCard(db: Db) {
  await db.insert(shopCard).values(TEST_SHOP_CARD).onConflictDoNothing();
}

export interface StaffSession {
  staff: StaffRow;
  /** Value of the `lummi_admin` cookie, ready for a `cookie` header. */
  cookie: string;
  /** Typed client that sends the staff session cookie. */
  client: ReturnType<typeof makeClient>;
}

export const OWNER_WIDGET_USER: WidgetUser = { id: 900001, first_name: 'Owner' };
export const MANAGER_WIDGET_USER: WidgetUser = { id: 900002, first_name: 'Manager' };

export interface TestApp {
  app: INestApplication;
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
  /** The app's WorkerRuntime with delivery started (the API dispatches to the same queue); closed by `close()`. */
  startWorker(): WorkerRuntime;
  /** Signed Login Widget payload for a user, "now" per the fake clock unless overridden. */
  widgetPayload(
    user: WidgetUser,
    overrides?: { authDate?: number },
  ): Record<string, string | number>;
  /** Insert (or update) a staff row and sign in through the real widget path. */
  signInStaff(
    role: StaffRole,
    user?: WidgetUser,
    opts?: { active?: boolean },
  ): Promise<StaffSession>;
  /** Shortcut for `signInStaff('owner')` with a stable test user (Seam 1 helper for later tickets). */
  ownerSession(): Promise<StaffSession>;
  /** Shortcut for `signInStaff('manager')` with a stable test user. */
  managerSession(): Promise<StaffSession>;
  /** A typed client that sends this staff session cookie (`lummi_admin=...`). */
  withCookie(cookie: string): ReturnType<typeof makeClient>;
  /** Per-test isolation: empties every table (identity restarted), then re-adds the 14 regions and the shop card. Call in beforeEach. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

function makeClient(baseUrl: string, token?: string, cookie?: string) {
  return initClient(apiContract, {
    baseUrl,
    baseHeaders: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    throwOnUnknownStatus: true,
  });
}

/**
 * Seam 1 (ADR 0028): the real API in process over HTTP, a real Postgres, the four edges faked.
 * Each call clones a private database from the migrated template of the shared test Postgres,
 * so test files can run in parallel without seeing each other's rows. `envOverrides` replace env
 * values; `undefined` removes a default (say, no internal secret).
 */
export async function createTestApp(
  envOverrides: Record<string, string | undefined> = {},
): Promise<TestApp> {
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
    OUTBOX_QUEUE: `q_${dbName}`,
    EVENTS_QUEUE: `e_${dbName}`,
    RECEIPT_CHECKS_QUEUE: `r_${dbName}`,
    BOT_RECEIPTS_QUEUE: `bq_${dbName}`,
    REVIEW_PHOTOS_QUEUE: `rp_${dbName}`,
    RECEIPT_CHECK_BACKOFF_MS: '200',
    BROADCAST_QUEUE: `b_${dbName}`,
    BIRTHDAY_QUEUE: `d_${dbName}`,
    ADMIN_DEV_LOGIN: 'true',
    INTERNAL_API_SECRET: TEST_INTERNAL_SECRET,
    ...envOverrides,
  });
  const { db, pool } = createDb(env.DATABASE_URL, 3);
  await seedShopCard(db);
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
  let worker: WorkerRuntime | undefined;
  let redis: Redis | undefined;
  const queueNames = [
    env.OUTBOX_QUEUE,
    env.EVENTS_QUEUE,
    env.RECEIPT_CHECKS_QUEUE,
    env.BOT_RECEIPTS_QUEUE,
    env.REVIEW_PHOTOS_QUEUE,
    env.BROADCAST_QUEUE,
    env.BIRTHDAY_QUEUE,
  ];
  /** Waiting, delayed and finished jobs out of every queue (running ones are waited for first). */
  const clearQueues = async () => {
    redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    for (const name of queueNames) {
      const queue = new Queue(name, { connection: redis });
      await queue.drain(true);
      await queue.clean(0, 0, 'failed');
      await queue.clean(0, 0, 'completed');
      await queue.close();
    }
  };

  const initData: TestApp['initData'] = (user = DEFAULT_TEST_USER, overrides = {}) =>
    signInitData({
      botToken: TEST_BOT_TOKEN,
      user,
      authDate: overrides.authDate ?? Math.floor(edges.clock.now().getTime() / 1000),
    });

  const client = makeClient(baseUrl);
  const widgetPayload: TestApp['widgetPayload'] = (user, overrides = {}) =>
    signLoginWidget({
      botToken: TEST_BOT_TOKEN,
      user,
      authDate: overrides.authDate ?? Math.floor(edges.clock.now().getTime() / 1000),
    });
  const signInStaff: TestApp['signInStaff'] = async (role, user, opts = {}) => {
    const u = user ?? (role === 'owner' ? OWNER_WIDGET_USER : MANAGER_WIDGET_USER);
    const values = {
      telegramId: u.id,
      name: u.first_name,
      role,
      active: opts.active ?? true,
    };
    const [row] = await db
      .insert(staff)
      .values(values)
      .onConflictDoUpdate({ target: staff.telegramId, set: values })
      .returning();
    const res = await client.admin.loginWidget({ body: widgetPayload(u) as never });
    if (res.status !== 200) throw new Error(`test staff sign-in failed: ${res.status}`);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return { staff: row as StaffRow, cookie, client: makeClient(baseUrl, undefined, cookie) };
  };
  return {
    app,
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
      const started = app.get(WorkerRuntime);
      started.start();
      worker = started;
      return started;
    },
    widgetPayload,
    signInStaff,
    ownerSession: () => signInStaff('owner'),
    managerSession: () => signInStaff('manager'),
    withCookie: (cookie) => makeClient(baseUrl, undefined, cookie),
    async signIn(user) {
      const res = await client.auth.telegram({ body: { initData: initData(user) } });
      if (res.status !== 200) throw new Error(`test sign-in failed: ${res.status}`);
      return { token: res.body.token, client: makeClient(baseUrl, res.body.token) };
    },
    async reset() {
      // Jobs live in Redis and survive the truncate, while every id restarts: a job still running,
      // or queued, from the test before would run against this test's rows of the same ids, or
      // keep its job id and stop this test's row from being queued (#37 review). Wait for the
      // running ones, drop the rest, and only then truncate.
      await worker?.pause();
      await clearQueues();
      const { rows } = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_%'`,
      );
      const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
      // Background work the previous test started (a credit's matching job, an outbox send) can
      // still hold row locks; Postgres then aborts one side of the deadlock. Retry the truncate:
      // the other side finishes, and whatever it wrote is truncated with the rest.
      for (let attempt = 1; tables; attempt++) {
        try {
          await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
          break;
        } catch (err) {
          if ((err as { code?: string }).code !== '40P01' || attempt >= 5) throw err;
          await new Promise((r) => setTimeout(r, 50 * attempt));
        }
      }
      // reference data, like the migrated schema itself
      await seedRegions(db);
      await seedShopCard(db);
      // the migration inserts the one Discovery set row (ADR 0009); the truncate took it too
      await pool.query(
        `INSERT INTO discovery_set (id, price, on_hand, is_placeholder) VALUES (true, 299000, 0, true)`,
      );
      await worker?.resume();
    },
    async close() {
      await app.close();
      redis?.disconnect();
      await pool.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

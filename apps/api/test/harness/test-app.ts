import { createDb, staff, type Db, type StaffRole, type StaffRow } from '@lummi/db';
import type { INestApplication } from '@nestjs/common';
import { initClient } from '@ts-rest/core';
import { contract } from '@lummi/contracts';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../src/app';
import { parseEnv, type Env } from '../../src/env';
import { createFakeEdges, type FakeEdges } from '../fakes';
import { signLoginWidget, type WidgetUser } from './sign-login-widget';
import { DEFAULT_TEST_USER, signInitData, type TestUser } from './sign-init-data';

export const TEST_BOT_TOKEN = '123456:TEST-bot-token-for-unit-tests';

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
  /** Per-test isolation: empties every table (identity restarted). Call in beforeEach. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

function makeClient(baseUrl: string, token?: string, cookie?: string) {
  return initClient(contract, {
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
 * so test files can run in parallel without seeing each other's rows.
 */
export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
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
    ADMIN_DEV_LOGIN: 'true',
    ...envOverrides,
  });
  const { db, pool } = createDb(env.DATABASE_URL, 3);
  const edges = createFakeEdges();
  const app: INestApplication = await createApp({ env, db, edges });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

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
    baseUrl,
    db,
    env,
    edges,
    client,
    initData,
    widgetPayload,
    signInStaff,
    ownerSession: () => signInStaff('owner'),
    managerSession: () => signInStaff('manager'),
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
      await app.close();
      await pool.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

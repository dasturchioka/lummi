import { randomUUID } from 'node:crypto';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { and, btsPoints, eq, fragrances, regions, volumes } from '@lummi/db';
import pg from 'pg';
import type { TestUser } from './sign-init-data';
import { TEST_BOT_TOKEN, type TestApp } from './test-app';

/** A signed-in shopper who has shared a phone (ADR 0004), ready to check out. */
export async function shopper(t: TestApp, user: TestUser, phone: string) {
  const { client } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  const res = await client.me.shareContact({ body: { proof } });
  if (res.status !== 200) throw new Error(`contact: ${res.status}`);
  return client;
}

/** The first `n` fragrance slugs in a fixed (sorted) order. */
export async function slugs(t: TestApp, n: number) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}

/** A fragrance's 10 ml volume. */
export async function tenMl(t: TestApp, slug: string) {
  const [v] = await t.db
    .select({ id: volumes.id, fragranceId: volumes.fragranceId })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, 10)));
  return v!;
}

/** An active BTS point in Samarkand. */
export async function samarkandPoint(t: TestApp) {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  return point!;
}

export const orderBody = (pointId: number, confirmedTotal: number) =>
  ({
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998 90 123 45 67',
    delivery: { kind: 'point', pointId },
    consent: true,
    idempotencyKey: randomUUID(),
    confirmedTotal,
    confirmedDiscount: null,
  }) satisfies CreateOrderBody;

/**
 * Runs `run` while another session holds an EXCLUSIVE lock on `table` (reads pass, writes wait),
 * released after `holdMs`: concurrent requests line up at their first write to it.
 */
export async function whileTableLocked<T>(
  t: TestApp,
  table: string,
  run: () => Promise<T>,
  holdMs = 600,
): Promise<T> {
  const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query('begin');
    await locker.query(`lock table ${table} in exclusive mode`);
    const pending = run();
    await new Promise((r) => setTimeout(r, holdMs));
    await locker.query('commit');
    return await pending;
  } finally {
    await locker.end();
  }
}

/**
 * Runs `run` while another session holds an EXCLUSIVE lock on `table`, and releases it only once
 * `waiters` sessions are blocked on a lock: the race is then real, not a hope that two requests
 * overlapped within some fixed time.
 */
export async function whileLockedUntil<T>(
  t: TestApp,
  table: string,
  waiters: number,
  run: () => Promise<T>,
): Promise<T> {
  const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query('begin');
    await locker.query(`lock table ${table} in exclusive mode`);
    const pending = run();
    await untilWaitingOnLocks(locker, waiters);
    await locker.query('commit');
    return await pending;
  } finally {
    await locker.end();
  }
}

/** Returns once `waiters` other sessions of this database are blocked on a lock (10 s at most). */
export async function untilWaitingOnLocks(client: pg.Client, waiters: number): Promise<void> {
  for (const deadline = Date.now() + 10_000; ;) {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
    );
    if (rows[0]!.n >= waiters) return;
    if (Date.now() > deadline)
      throw new Error(`only ${rows[0]!.n} of ${waiters} sessions reached a lock`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

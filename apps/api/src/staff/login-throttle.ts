import { and, gt, inArray, loginThrottles, lt, or, sql, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

export type ThrottleScope = 'login' | 'ip';
export interface ThrottleKey {
  scope: ThrottleScope;
  key: string;
}

const id = (k: ThrottleKey) => `${k.scope}:${k.key}`;

/**
 * Wrong passwords counted per login and per client address (ADR 0038). `perLogin` failures in
 * `window` lock that login; `perIp` failures from one address (whatever the logins) lock the
 * address. A lock lasts `lock` seconds, during which no password is checked at all; the count
 * then starts again from zero. All four numbers are settings.
 */
@Injectable()
export class LoginThrottle {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  /** When the last of these keys' locks ends, or null when none is locked now. */
  async lockedUntil(keys: ThrottleKey[]): Promise<Date | null> {
    const now = this.edges.clock.now();
    const rows = await this.db
      .select({ until: loginThrottles.lockedUntil })
      .from(loginThrottles)
      .where(and(this.match(keys), gt(loginThrottles.lockedUntil, now)));
    const ends = rows.map((r) => r.until!.getTime());
    return ends.length ? new Date(Math.max(...ends)) : null;
  }

  /**
   * One failure on each key. Returns the keys this failure locked, with the lock's end; in one
   * transaction, so two failures at once still count as two.
   */
  async fail(keys: ThrottleKey[]): Promise<{ key: ThrottleKey; until: Date }[]> {
    const now = this.edges.clock.now();
    const s = await readSettings(this.db, [
      'auth.passwordAttemptsPerLogin',
      'auth.passwordAttemptsPerIp',
      'auth.passwordAttemptWindowSeconds',
      'auth.passwordLockSeconds',
    ]);
    const windowStart = new Date(now.getTime() - s['auth.passwordAttemptWindowSeconds'] * 1000);
    const until = new Date(now.getTime() + s['auth.passwordLockSeconds'] * 1000);
    return this.db.transaction(async (tx) => {
      // rows nobody needs any more (window over, no lock running) go, so the table stays small
      await tx
        .delete(loginThrottles)
        .where(
          and(
            lt(loginThrottles.windowStartedAt, windowStart),
            or(sql`${loginThrottles.lockedUntil} is null`, lt(loginThrottles.lockedUntil, now)),
          ),
        );
      const locked: { key: ThrottleKey; until: Date }[] = [];
      for (const key of keys) {
        const limit =
          key.scope === 'login'
            ? s['auth.passwordAttemptsPerLogin']
            : s['auth.passwordAttemptsPerIp'];
        const fresh = sql`${loginThrottles.windowStartedAt} < ${windowStart}`;
        const [row] = await tx
          .insert(loginThrottles)
          .values({ ...key, failures: 1, windowStartedAt: now })
          .onConflictDoUpdate({
            target: [loginThrottles.scope, loginThrottles.key],
            set: {
              failures: sql`case when ${fresh} then 1 else ${loginThrottles.failures} + 1 end`,
              windowStartedAt: sql`case when ${fresh} then ${now} else ${loginThrottles.windowStartedAt} end`,
            },
          })
          .returning({ failures: loginThrottles.failures });
        if ((row?.failures ?? 0) < limit) continue;
        await this.lock(tx, key, now, until);
        locked.push({ key, until });
      }
      return locked;
    });
  }

  /** A right password: this login's count starts again (an address keeps its count). */
  async clear(key: ThrottleKey): Promise<void> {
    await this.db.delete(loginThrottles).where(this.match([key]));
  }

  private async lock(tx: DbOrTx, key: ThrottleKey, now: Date, until: Date) {
    await tx
      .update(loginThrottles)
      .set({ failures: 0, windowStartedAt: now, lockedUntil: until })
      .where(this.match([key]));
  }

  private match(keys: ThrottleKey[]) {
    return inArray(
      sql`${loginThrottles.scope}::text || ':' || ${loginThrottles.key}`,
      keys.map(id),
    );
  }
}

import { eq, loginThrottles, sql, staff, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

export type ThrottleScope = 'login' | 'ip';
export interface ThrottleKey {
  scope: ThrottleScope;
  key: string;
}
type ThrottleRow = typeof loginThrottles.$inferSelect;

export type Admission = { ok: true } | { ok: false; retryAt: Date };

/** Login first, then the address: every transaction takes the row locks in this order. */
const inOrder = (keys: ThrottleKey[]) =>
  [...keys].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'login' ? -1 : 1));

/**
 * Password attempts counted per login and per client address (ADR 0038). An attempt is counted
 * before its password is checked, under a row lock, so a burst of parallel guesses gets no more
 * than the limit: `auth.passwordAttemptsPerLogin` attempts on one login, or
 * `auth.passwordAttemptsPerIp` from one address (whatever the logins), within
 * `auth.passwordAttemptWindowSeconds`. Past the limit, or when the limit-th guess was wrong, the
 * login or address is locked for `auth.passwordLockSeconds`, during which no password is checked
 * at all; the count then starts again. A right password takes its attempt back.
 */
@Injectable()
export class LoginThrottle {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Before the password is checked: count this attempt on every key, or refuse it (a lock is
   * running, or the attempts in the window are used up, which locks now). One transaction, so a
   * refusal on one key counts nothing on the other.
   */
  async admit(keys: ThrottleKey[]): Promise<Admission> {
    const rules = await this.rules();
    await this.prune(rules);
    return this.db.transaction(async (tx) => {
      const rows = await this.lockRows(tx, keys);
      const running = rows
        .map(({ row }) => row.lockedUntil)
        .filter((until): until is Date => until !== null && until > rules.now);
      if (running.length) return { ok: false, retryAt: latest(running) };

      const counted = rows.map(({ key, row }) => {
        const windowOver = row.windowStartedAt < rules.windowStart;
        return {
          key,
          attempts: windowOver ? 0 : row.failures,
          windowStartedAt: windowOver ? rules.now : row.windowStartedAt,
        };
      });
      const usedUp = counted.filter((c) => c.attempts >= rules.limit(c.key));
      if (usedUp.length) {
        // earlier attempts still being checked have used the allowance: lock now
        for (const { key } of usedUp) await this.lock(tx, key, rules);
        return { ok: false, retryAt: rules.until };
      }
      for (const c of counted) {
        await tx
          .update(loginThrottles)
          .set({ failures: c.attempts + 1, windowStartedAt: c.windowStartedAt, lockedUntil: null })
          .where(this.match([c.key]));
      }
      return { ok: true };
    });
  }

  /**
   * The password was wrong (the attempt is counted already): a key whose count reached its limit
   * locks. Returns when sign-in opens again if any of the keys is locked now, else null.
   */
  async fail(keys: ThrottleKey[]): Promise<Date | null> {
    const rules = await this.rules();
    return this.db.transaction(async (tx) => {
      const locks: Date[] = [];
      for (const { key, row } of await this.lockRows(tx, keys)) {
        if (row.lockedUntil && row.lockedUntil > rules.now) locks.push(row.lockedUntil);
        else if (row.failures >= rules.limit(key)) {
          await this.lock(tx, key, rules);
          locks.push(rules.until);
        }
      }
      return locks.length ? latest(locks) : null;
    });
  }

  /** The password was right: the login's count goes, the address takes this attempt back. */
  async succeed(keys: ThrottleKey[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const key of inOrder(keys)) {
        if (key.scope === 'login') {
          await tx.delete(loginThrottles).where(this.match([key]));
        } else {
          await tx
            .update(loginThrottles)
            .set({ failures: sql`greatest(${loginThrottles.failures} - 1, 0)` })
            .where(this.match([key]));
        }
      }
    });
  }

  private async rules() {
    const now = this.edges.clock.now();
    const values = await readSettings(this.db, [
      'auth.passwordAttemptsPerLogin',
      'auth.passwordAttemptsPerIp',
      'auth.passwordAttemptWindowSeconds',
      'auth.passwordLockSeconds',
    ]);
    return {
      now,
      windowStart: new Date(now.getTime() - values['auth.passwordAttemptWindowSeconds'] * 1000),
      until: new Date(now.getTime() + values['auth.passwordLockSeconds'] * 1000),
      limit: (key: ThrottleKey) =>
        key.scope === 'login'
          ? values['auth.passwordAttemptsPerLogin']
          : values['auth.passwordAttemptsPerIp'],
    };
  }

  /**
   * Rows nobody needs any more (window over, no lock running) go, so the table stays small.
   * Apart from the count, skipping rows another attempt holds: never waits, so never deadlocks.
   */
  private async prune(rules: { now: Date; windowStart: Date }) {
    await this.db.execute(sql`
      delete from ${loginThrottles} where ctid in (
        select ctid from ${loginThrottles}
        where ${loginThrottles.windowStartedAt} < ${rules.windowStart}
          and (${loginThrottles.lockedUntil} is null or ${loginThrottles.lockedUntil} < ${rules.now})
        for update skip locked
      )`);
  }

  /** Each key's row, created when missing, locked for the rest of the transaction, in order. */
  private async lockRows(tx: DbOrTx, keys: ThrottleKey[]) {
    const now = this.edges.clock.now();
    const out: { key: ThrottleKey; row: ThrottleRow }[] = [];
    for (const key of inOrder(keys)) {
      await tx
        .insert(loginThrottles)
        .values({ ...key, failures: 0, windowStartedAt: now })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(loginThrottles)
        .where(this.match([key]))
        .for('update');
      out.push({ key, row: row as ThrottleRow });
    }
    return out;
  }

  /**
   * Lock one key and audit it: `staff.locked` when the login is a staff member's,
   * `auth.address_locked` for an address. An unknown login locks silently (it answers alike).
   */
  private async lock(tx: DbOrTx, key: ThrottleKey, rules: { now: Date; until: Date }) {
    await tx
      .update(loginThrottles)
      .set({ failures: 0, windowStartedAt: rules.now, lockedUntil: rules.until })
      .where(this.match([key]));
    const until = rules.until.toISOString();
    if (key.scope === 'ip') {
      await this.audit.record(tx, {
        actor: { type: 'system' },
        action: 'auth.address_locked',
        targetType: 'ip',
        targetId: key.key,
        payload: { until },
      });
      return;
    }
    const [member] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.login, key.key));
    if (!member) return;
    await this.audit.record(tx, {
      actor: { type: 'system' },
      action: 'staff.locked',
      targetType: 'staff',
      targetId: member.id,
      payload: { until, by: 'login' },
    });
  }

  /** `(scope, key) in (...)`: the primary key serves it. */
  private match(keys: ThrottleKey[]) {
    const pairs = keys.map((k) => sql`(${k.scope}::login_throttle_scope, ${k.key})`);
    return sql`(${loginThrottles.scope}, ${loginThrottles.key}) in (${sql.join(pairs, sql`, `)})`;
  }
}

const latest = (dates: Date[]) => new Date(Math.max(...dates.map((d) => d.getTime())));

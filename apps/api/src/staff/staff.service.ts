import { and, asc, eq, ne, staff, type Db, type DbOrTx, type StaffRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { LoginThrottle } from './login-throttle';
import { hashPassword, verifyPassword } from './password';
import { StaffSessionService } from './staff-session.service';

export type StaffRefusal =
  'not_found' | 'conflict' | 'login_taken' | 'login_required' | 'telegram_only';

/** A new password refused (ADR 0038); `minLength` is the setting, for the message. */
export type PasswordRefusal = {
  ok: false;
  reason: 'weak_password' | 'same_password' | 'wrong_password';
  minLength: number;
};

export type StaffOutcome<T = StaffRow> =
  { ok: true; staff: T } | { ok: false; reason: StaffRefusal };

export type PasswordChangeOutcome =
  | { ok: true; staff: StaffRow }
  | PasswordRefusal
  | { ok: false; reason: 'locked'; retryAt: Date }
  | { ok: false; reason: 'login_required' };

@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
  ) {}

  async findByTelegramId(telegramId: number, db: DbOrTx = this.db): Promise<StaffRow | null> {
    const [row] = await db.select().from(staff).where(eq(staff.telegramId, telegramId));
    return row ?? null;
  }

  /** `login` already folded to lower case. */
  async findByLogin(login: string): Promise<StaffRow | null> {
    const [row] = await this.db.select().from(staff).where(eq(staff.login, login));
    return row ?? null;
  }

  list(): Promise<StaffRow[]> {
    return this.db.select().from(staff).orderBy(asc(staff.id));
  }

  /** The shortest password taken now (`auth.passwordMinLength`). */
  minPasswordLength(): Promise<number> {
    return this.settings.get('auth.passwordMinLength');
  }

  /**
   * The panel only ever adds managers; owners come from the server CLI. The password is
   * temporary: the manager changes it at the first sign-in.
   */
  async addManager(
    actor: StaffRow,
    input: { name: string; login: string; password: string },
  ): Promise<StaffOutcome | PasswordRefusal> {
    const minLength = await this.minPasswordLength();
    if (input.password.length < minLength) return { ok: false, reason: 'weak_password', minLength };
    const passwordHash = await hashPassword(input.password);
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(staff)
        .values({
          name: input.name,
          login: input.login,
          passwordHash,
          mustChangePassword: true,
          role: 'manager',
        })
        .onConflictDoNothing({ target: staff.login })
        .returning();
      if (!created) return { ok: false, reason: 'login_taken' } as const;
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'staff.created',
        targetType: 'staff',
        targetId: created.id,
        payload: { name: created.name, login: created.login, role: created.role },
      });
      return { ok: true, staff: created } as const;
    });
  }

  /**
   * «Сбросить пароль»: a new temporary password, and every session of that manager ends in the
   * same transaction. A manager without a login (added by Telegram id before #50) gets one here.
   */
  async resetPassword(
    actor: StaffRow,
    id: number,
    input: { password: string; login?: string },
  ): Promise<StaffOutcome | PasswordRefusal> {
    const minLength = await this.minPasswordLength();
    if (input.password.length < minLength) return { ok: false, reason: 'weak_password', minLength };
    const passwordHash = await hashPassword(input.password);
    return this.db.transaction(async (tx) => {
      const locked = await this.lockManager(tx, id);
      if (!locked.ok) return locked;
      const target = locked.staff;
      const login = target.login ?? input.login;
      if (!login) return { ok: false, reason: 'login_required' } as const;
      if (!target.login && (await this.loginTaken(tx, login, id))) {
        return { ok: false, reason: 'login_taken' } as const;
      }
      const [updated] = await tx
        .update(staff)
        .set({ login, passwordHash, mustChangePassword: true, updatedAt: this.edges.clock.now() })
        .where(eq(staff.id, id))
        .returning();
      await this.sessions.revokeAll(tx, id);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'staff.password_reset',
        targetType: 'staff',
        targetId: id,
        payload: { name: target.name, login },
      });
      return { ok: true, staff: updated as StaffRow } as const;
    });
  }

  /**
   * «Сменить пароль» and the forced change after a temporary password. The current password is
   * asked for unless the one in place is temporary (or there is none yet); wrong guesses count
   * toward the login's lock. Every other session of the member ends; `keepToken`'s stays.
   */
  async changePassword(
    member: StaffRow,
    input: { currentPassword?: string; newPassword: string },
    keepToken: string,
  ): Promise<PasswordChangeOutcome> {
    if (!member.login) return { ok: false, reason: 'login_required' };
    const minLength = await this.minPasswordLength();
    const key = { scope: 'login', key: member.login } as const;
    if (member.passwordHash && !member.mustChangePassword) {
      const until = await this.throttle.lockedUntil([key]);
      if (until) return { ok: false, reason: 'locked', retryAt: until };
      const current = input.currentPassword ?? '';
      if (!current || !(await verifyPassword(current, member.passwordHash))) {
        const [lock] = await this.throttle.fail([key]);
        if (lock) {
          await this.recordLock(this.db, member, lock.until);
          return { ok: false, reason: 'locked', retryAt: lock.until };
        }
        return { ok: false, reason: 'wrong_password', minLength };
      }
    }
    if (member.passwordHash && (await verifyPassword(input.newPassword, member.passwordHash))) {
      return { ok: false, reason: 'same_password', minLength };
    }
    if (input.newPassword.length < minLength)
      return { ok: false, reason: 'weak_password', minLength };
    const passwordHash = await hashPassword(input.newPassword);
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(staff)
        .set({ passwordHash, mustChangePassword: false, updatedAt: this.edges.clock.now() })
        .where(eq(staff.id, member.id))
        .returning();
      await this.sessions.revokeOthers(tx, member.id, keepToken);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: member.id },
        action: 'staff.password_changed',
        targetType: 'staff',
        targetId: member.id,
        payload: { forced: member.mustChangePassword },
      });
      return { ok: true, staff: updated as StaffRow } as const;
    });
  }

  /** The owner unbinds a manager's Telegram; refused when it is their only way in. */
  async unlinkTelegram(actor: StaffRow, id: number): Promise<StaffOutcome> {
    return this.db.transaction(async (tx) => {
      const locked = await this.lockManager(tx, id);
      if (!locked.ok) return locked;
      const target = locked.staff;
      if (target.telegramId === null) return locked;
      if (!target.passwordHash) return { ok: false, reason: 'telegram_only' } as const;
      const [updated] = await tx
        .update(staff)
        .set({ telegramId: null, updatedAt: this.edges.clock.now() })
        .where(eq(staff.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'staff.telegram_unlinked',
        targetType: 'staff',
        targetId: id,
        payload: { name: target.name, telegramId: target.telegramId },
      });
      return { ok: true, staff: updated as StaffRow } as const;
    });
  }

  /** Deactivation and the revocation of every session of that manager commit together. */
  async setActive(actor: StaffRow, id: number, active: boolean): Promise<StaffOutcome> {
    return this.db.transaction(async (tx) => {
      const locked = await this.lockManager(tx, id);
      if (!locked.ok) return locked;
      const target = locked.staff;
      const [updated] = await tx
        .update(staff)
        .set({ active, updatedAt: this.edges.clock.now() })
        .where(eq(staff.id, id))
        .returning();
      if (!active) await this.sessions.revokeAll(tx, id);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: active ? 'staff.activated' : 'staff.deactivated',
        targetType: 'staff',
        targetId: id,
        payload: { telegramId: target.telegramId, login: target.login, name: target.name },
      });
      return { ok: true, staff: updated as StaffRow } as const;
    });
  }

  /** Sessions go with the row (FK cascade). The audit entry keeps the name for the history. */
  async remove(actor: StaffRow, id: number): Promise<StaffOutcome> {
    return this.db.transaction(async (tx) => {
      const locked = await this.lockManager(tx, id);
      if (!locked.ok) return locked;
      const target = locked.staff;
      await tx.delete(staff).where(eq(staff.id, id));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'staff.removed',
        targetType: 'staff',
        targetId: id,
        payload: {
          telegramId: target.telegramId,
          login: target.login,
          name: target.name,
          role: target.role,
        },
      });
      return { ok: true, staff: target } as const;
    });
  }

  /** `staff.locked`: too many wrong passwords for this member's login (ADR 0038). */
  async recordLock(db: DbOrTx, member: StaffRow, until: Date): Promise<void> {
    await this.audit.record(db, {
      actor: { type: 'system' },
      action: 'staff.locked',
      targetType: 'staff',
      targetId: member.id,
      payload: { until: until.toISOString(), by: 'login' },
    });
  }

  private async loginTaken(tx: DbOrTx, login: string, exceptId: number): Promise<boolean> {
    const [row] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.login, login), ne(staff.id, exceptId)));
    return row !== undefined;
  }

  /** Locks the row for the rest of the transaction; the panel only ever changes managers. */
  private async lockManager(tx: DbOrTx, id: number): Promise<StaffOutcome> {
    const [target] = await tx.select().from(staff).where(eq(staff.id, id)).for('update');
    if (!target) return { ok: false, reason: 'not_found' };
    if (target.role !== 'manager') return { ok: false, reason: 'conflict' };
    return { ok: true, staff: target };
  }
}

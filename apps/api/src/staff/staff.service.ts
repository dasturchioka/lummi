import { and, asc, eq, ne, or, staff, type Db, type DbOrTx, type StaffRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { deleteProfilePhotoFiles } from '../profile-photo/profile-photo-pipeline';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { LoginThrottle } from './login-throttle';
import { hashPassword, verifyPassword } from './password';
import { StaffSessionService } from './staff-session.service';

export type StaffRefusal =
  | 'not_found'
  | 'conflict'
  | 'login_taken'
  | 'login_required'
  | 'telegram_only'
  | 'own_role'
  | 'last_owner'
  | 'inactive';

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
  | { ok: false; reason: 'login_required' | 'conflict' };

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

  async findById(id: number): Promise<StaffRow | null> {
    const [row] = await this.db.select().from(staff).where(eq(staff.id, id));
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
   * The first owner comes from the server CLI; after that an owner adds managers or other owners
   * (spec, 2026-11-18). The password is temporary: the member changes it at the first sign-in.
   */
  async addMember(
    actor: StaffRow,
    input: { name: string; login: string; password: string; role: StaffRow['role'] },
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
          role: input.role,
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
   * asked for unless the one in place is temporary (or there is none yet); each try counts toward
   * the login's lock before it is checked. The change commits only if the row is still as it was
   * checked (locked `FOR UPDATE`): an owner's reset in between wins and this change is refused.
   * Every other session of the member ends; `keepToken`'s stays.
   */
  async changePassword(
    member: StaffRow,
    input: { currentPassword?: string; newPassword: string },
    keepToken: string,
  ): Promise<PasswordChangeOutcome> {
    const [checked] = await this.db.select().from(staff).where(eq(staff.id, member.id));
    if (!checked?.login) return { ok: false, reason: 'login_required' };
    const minLength = await this.minPasswordLength();
    const key = { scope: 'login', key: checked.login } as const;
    if (checked.passwordHash && !checked.mustChangePassword) {
      const admission = await this.throttle.admit([key]);
      if (!admission.ok) return { ok: false, reason: 'locked', retryAt: admission.retryAt };
      const current = input.currentPassword ?? '';
      const currentMatches =
        current !== '' && (await verifyPassword(current, checked.passwordHash));
      if (!currentMatches) {
        const lockedUntil = await this.throttle.fail([key]);
        if (lockedUntil) return { ok: false, reason: 'locked', retryAt: lockedUntil };
        return { ok: false, reason: 'wrong_password', minLength };
      }
      await this.throttle.succeed([key]);
    }
    if (checked.passwordHash && (await verifyPassword(input.newPassword, checked.passwordHash))) {
      return { ok: false, reason: 'same_password', minLength };
    }
    if (input.newPassword.length < minLength)
      return { ok: false, reason: 'weak_password', minLength };
    const passwordHash = await hashPassword(input.newPassword);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(staff).where(eq(staff.id, member.id)).for('update');
      if (
        !row ||
        row.passwordHash !== checked.passwordHash ||
        row.mustChangePassword !== checked.mustChangePassword
      ) {
        return { ok: false, reason: 'conflict' } as const;
      }
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
        payload: { forced: row.mustChangePassword },
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

  /**
   * Changes a member's role. The guards read the role from the row on every request, so the
   * member's open sessions follow at once; no session is revoked. Refused: your own role, and a
   * demotion that would leave no other active owner (rows locked, so two owners demoting each
   * other at once can't both pass), and promoting a switched-off member.
   */
  async setRole(actor: StaffRow, id: number, role: StaffRow['role']): Promise<StaffOutcome> {
    if (actor.id === id) return { ok: false, reason: 'own_role' };
    return this.db.transaction(async (tx) => {
      // the target and every owner, locked in id order: the actor's standing and the owner count
      // are read inside the lock, so a concurrent demotion can't slip past either check
      const rows = await tx
        .select()
        .from(staff)
        .where(or(eq(staff.id, id), eq(staff.role, 'owner')))
        .orderBy(asc(staff.id))
        .for('update');
      const target = rows.find((s) => s.id === id);
      if (!target) return { ok: false, reason: 'not_found' } as const;
      if (
        role === 'manager' &&
        target.role === 'owner' &&
        !rows.some((s) => s.id !== id && s.role === 'owner' && s.active)
      ) {
        return { ok: false, reason: 'last_owner' } as const;
      }
      // the actor must still be an active owner now, not only when the request was admitted
      if (!rows.some((s) => s.id === actor.id && s.role === 'owner' && s.active)) {
        return { ok: false, reason: 'conflict' } as const;
      }
      if (target.role === role) return { ok: true, staff: target } as const;
      // a switched-off member can't be made an owner (switch them on first)
      if (role === 'owner' && !target.active) return { ok: false, reason: 'inactive' } as const;
      const [updated] = await tx
        .update(staff)
        .set({ role, updatedAt: this.edges.clock.now() })
        .where(eq(staff.id, id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'staff.role_changed',
        targetType: 'staff',
        targetId: id,
        payload: { name: target.name, login: target.login, from: target.role, to: role },
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
    const res = await this.removeRow(actor, id);
    if (res.ok && res.staff.photoKey) {
      await deleteProfilePhotoFiles(this.edges.files, res.staff.photoKey);
    }
    return res;
  }

  private async removeRow(actor: StaffRow, id: number): Promise<StaffOutcome> {
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

  private async loginTaken(tx: DbOrTx, login: string, exceptId: number): Promise<boolean> {
    const [row] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.login, login), ne(staff.id, exceptId)));
    return row !== undefined;
  }

  /** Locks the row for the rest of the transaction; reset, switch-off, unlink and remove take managers only. */
  private async lockManager(tx: DbOrTx, id: number): Promise<StaffOutcome> {
    const [target] = await tx.select().from(staff).where(eq(staff.id, id)).for('update');
    if (!target) return { ok: false, reason: 'not_found' };
    if (target.role !== 'manager') return { ok: false, reason: 'conflict' };
    return { ok: true, staff: target };
  }
}

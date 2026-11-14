import { generatePassword } from '@lummi/contracts';
import {
  and,
  eq,
  isNull,
  staff,
  staffSessions,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { readSettings } from '../settings/settings.service';
import { hashPassword } from './password';

const find = async (tx: DbOrTx, where: ReturnType<typeof eq>) =>
  (await tx.select().from(staff).where(where).for('update'))[0];

/**
 * CLI: create the first owner, or promote/reactivate an existing record found by Telegram id or
 * login, adding whichever of the two it lacks. Idempotent. The password is set separately
 * (`setOwnerPassword`), so a seed never prints or changes one.
 */
export async function seedOwner(
  db: Db,
  now: Date,
  input: { telegramId?: number; login?: string; name: string },
): Promise<StaffRow> {
  return db.transaction(async (tx) => {
    const byTelegram =
      input.telegramId === undefined
        ? undefined
        : await find(tx, eq(staff.telegramId, input.telegramId));
    const byLogin =
      input.login === undefined ? undefined : await find(tx, eq(staff.login, input.login));
    if (byTelegram && byLogin && byTelegram.id !== byLogin.id) {
      throw new Error(
        `Telegram id ${input.telegramId} and login «${input.login}» belong to two different staff records (${byTelegram.id}, ${byLogin.id})`,
      );
    }
    const existing = byTelegram ?? byLogin;
    const values = {
      telegramId: input.telegramId ?? existing?.telegramId ?? null,
      login: input.login ?? existing?.login ?? null,
      name: input.name,
      role: 'owner' as const,
      active: true,
    };
    const [row] = existing
      ? await tx
          .update(staff)
          .set({ ...values, updatedAt: now })
          .where(eq(staff.id, existing.id))
          .returning()
      : await tx.insert(staff).values(values).returning();
    if (!row) throw new Error('owner upsert returned no row');
    await new AuditService().record(tx, {
      actor: { type: 'system' },
      action: existing ? 'staff.owner_updated' : 'staff.owner_seeded',
      targetType: 'staff',
      targetId: row.id,
      payload: { telegramId: row.telegramId, login: row.login, name: row.name },
    });
    return row;
  });
}

/**
 * CLI, for a new owner or one who lost the password (ADR 0038): a generated temporary password,
 * returned once for the terminal and stored only as its hash. The owner must change it at the
 * next sign-in, and every session they have ends now.
 */
export async function setOwnerPassword(
  db: Db,
  now: Date,
  login: string,
): Promise<{ staff: StaffRow; password: string }> {
  const s = await readSettings(db, ['auth.passwordMinLength']);
  const password = generatePassword(s['auth.passwordMinLength'], (n) => randomBytes(n));
  const passwordHash = await hashPassword(password);
  const row = await db.transaction(async (tx) => {
    const owner = await find(tx, eq(staff.login, login));
    if (!owner || owner.role !== 'owner') {
      throw new Error(
        `No owner with the login «${login}». Add it first: seed:owner --login ${login} --name "<name>"`,
      );
    }
    const [updated] = await tx
      .update(staff)
      .set({ passwordHash, mustChangePassword: true, updatedAt: now })
      .where(eq(staff.id, owner.id))
      .returning();
    await tx
      .update(staffSessions)
      .set({ revokedAt: now })
      .where(and(eq(staffSessions.staffId, owner.id), isNull(staffSessions.revokedAt)));
    await new AuditService().record(tx, {
      actor: { type: 'system' },
      action: 'staff.password_reset',
      targetType: 'staff',
      targetId: owner.id,
      payload: { name: owner.name, login },
    });
    return updated as StaffRow;
  });
  return { staff: row, password };
}

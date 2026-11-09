import { eq, staff, type Db, type StaffRow } from '@lummi/db';
import { AuditService } from '../audit/audit.service';

/** CLI: create the first owner, or promote/reactivate an existing record. Idempotent. */
export async function seedOwner(
  db: Db,
  now: Date,
  input: { telegramId: number; name: string },
): Promise<StaffRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(staff).where(eq(staff.telegramId, input.telegramId));
    const [row] = await tx
      .insert(staff)
      .values({ telegramId: input.telegramId, name: input.name, role: 'owner', active: true })
      .onConflictDoUpdate({
        target: staff.telegramId,
        set: { name: input.name, role: 'owner', active: true, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error('owner upsert returned no row');
    await new AuditService().record(tx, {
      actor: { type: 'system' },
      action: existing ? 'staff.owner_updated' : 'staff.owner_seeded',
      targetType: 'staff',
      targetId: row.id,
      payload: { telegramId: input.telegramId, name: input.name },
    });
    return row;
  });
}

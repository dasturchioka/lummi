import { asc, eq, staff, type Db, type DbOrTx, type StaffRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { StaffSessionService } from './staff-session.service';

export type StaffOutcome<T = StaffRow> =
  { ok: true; staff: T } | { ok: false; reason: 'not_found' | 'conflict' };

@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  async findByTelegramId(telegramId: number, db: DbOrTx = this.db): Promise<StaffRow | null> {
    const [row] = await db.select().from(staff).where(eq(staff.telegramId, telegramId));
    return row ?? null;
  }

  list(): Promise<StaffRow[]> {
    return this.db.select().from(staff).orderBy(asc(staff.id));
  }

  /** The panel only ever adds managers; owners come from the server CLI. */
  async addManager(
    actor: StaffRow,
    input: { telegramId: number; name: string },
  ): Promise<StaffOutcome> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(staff)
        .values({ telegramId: input.telegramId, name: input.name, role: 'manager' })
        .onConflictDoNothing({ target: staff.telegramId })
        .returning();
      if (!created) return { ok: false, reason: 'conflict' } as const;
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'staff.created',
        targetType: 'staff',
        targetId: created.id,
        payload: { telegramId: created.telegramId, name: created.name, role: created.role },
      });
      return { ok: true, staff: created } as const;
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
        payload: { telegramId: target.telegramId, name: target.name },
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
        payload: { telegramId: target.telegramId, name: target.name, role: target.role },
      });
      return { ok: true, staff: target } as const;
    });
  }

  /** Locks the row for the rest of the transaction; the panel only ever changes managers. */
  private async lockManager(tx: DbOrTx, id: number): Promise<StaffOutcome> {
    const [target] = await tx.select().from(staff).where(eq(staff.id, id)).for('update');
    if (!target) return { ok: false, reason: 'not_found' };
    if (target.role !== 'manager') return { ok: false, reason: 'conflict' };
    return { ok: true, staff: target };
  }
}

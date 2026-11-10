import { tashkentToUtc, type AuditEntryDto, type AuditQuery } from '@lummi/contracts';
import { alias, and, auditLog, customers, desc, eq, sql, staff, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../tokens';

/** The start of a Tashkent day as a UTC instant; the caller has already checked it is a real day. */
export function dayStart(day: string, plusDays = 0): Date {
  const [year, month, d] = day.split('-').map(Number) as [number, number, number];
  // roll the calendar forward in UTC arithmetic, then read it back as a Tashkent wall-clock date
  const rolled = new Date(Date.UTC(year, month - 1, d + plusDays));
  return tashkentToUtc({
    year: rolled.getUTCFullYear(),
    month: rolled.getUTCMonth() + 1,
    day: rolled.getUTCDate(),
    hour: 0,
    minute: 0,
  }) as Date;
}

type Parsed = { page: number; pageSize: number } & Omit<AuditQuery, 'page' | 'pageSize'>;

/** The staff table a second time, for entries whose target is a staff member. */
const targetStaff = alias(staff, 'target_staff');

@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Newest first. Dates are Tashkent days: `from` inclusive from 00:00, `to` inclusive up to the next midnight. */
  async list(q: Parsed) {
    const conditions: ReturnType<typeof eq>[] = [];
    if (q.actor) {
      const [type, id] = q.actor.split(':') as [AuditEntryDto['actorType'], string | undefined];
      conditions.push(eq(auditLog.actorType, type));
      if (id) conditions.push(eq(auditLog.actorId, Number(id)));
    }
    if (q.action) conditions.push(eq(auditLog.action, q.action));
    if (q.from) conditions.push(sql`${auditLog.createdAt} >= ${dayStart(q.from).toISOString()}`);
    if (q.to) conditions.push(sql`${auditLog.createdAt} < ${dayStart(q.to, 1).toISOString()}`);
    const where = conditions.length ? and(...conditions) : undefined;

    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where);
    const items = await this.entries(where, q.pageSize, (q.page - 1) * q.pageSize);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** Every entry about one target (an order's page lists them), newest first. */
  async forTarget(targetType: string, targetId: string | number, limit = 200) {
    return this.entries(
      and(eq(auditLog.targetType, targetType), eq(auditLog.targetId, String(targetId))),
      limit,
      0,
    );
  }

  /** Entries newest first, with the actor's name (staff or customer) and a staff target's name. */
  private async entries(
    where: ReturnType<typeof and>,
    limit: number,
    offset: number,
  ): Promise<AuditEntryDto[]> {
    const rows = await this.db
      .select({
        row: auditLog,
        staffName: staff.name,
        customerName: customers.firstName,
        targetName: targetStaff.name,
      })
      .from(auditLog)
      .leftJoin(staff, sql`${auditLog.actorType} = 'staff' and ${auditLog.actorId} = ${staff.id}`)
      .leftJoin(
        customers,
        sql`${auditLog.actorType} = 'customer' and ${auditLog.actorId} = ${customers.id}`,
      )
      .leftJoin(
        targetStaff,
        sql`${auditLog.targetType} = 'staff' and ${auditLog.targetId} = ${targetStaff.id}::text`,
      )
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit)
      .offset(offset);

    return rows.map(({ row, staffName, customerName, targetName }) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: staffName ?? customerName ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName: targetName ?? null,
      payload: row.payload as Record<string, unknown>,
    }));
  }

  /** Staff are listed one by one; customers, the AI and the system are one filter each. */
  async filters() {
    const actions = await this.db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .orderBy(auditLog.action);
    const members = await this.db.select().from(staff).orderBy(staff.id);
    return {
      actions: actions.map((a) => a.action),
      actors: [
        ...members.map((m) => ({
          value: `staff:${m.id}`,
          type: 'staff' as const,
          name: m.name,
        })),
        { value: 'customer', type: 'customer' as const, name: null },
        { value: 'ai', type: 'ai' as const, name: null },
        { value: 'system', type: 'system' as const, name: null },
      ],
    };
  }
}

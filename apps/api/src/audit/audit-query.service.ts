import {
  tashkentDayStart as dayStart,
  type AuditEntryDto,
  type AuditQuery,
} from '@lummi/contracts';
import {
  alias,
  and,
  auditLog,
  customers,
  desc,
  eq,
  fragrances,
  inArray,
  promoBanners,
  sql,
  staff,
  volumes,
  type Db,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../tokens';

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

    const names = await this.targetNames(rows.map((r) => r.row));
    return rows.map(({ row, staffName, customerName, targetName }) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: staffName ?? customerName ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName: targetName ?? names.get(`${row.targetType}:${row.targetId}`) ?? null,
      payload: row.payload as Record<string, unknown>,
    }));
  }

  /**
   * Names for the targets that have one, in one query per kind for the whole page: a banner's
   * title, a fragrance's name, and the fragrance a volume belongs to. A deleted row has none.
   */
  private async targetNames(rows: { targetType: string; targetId: string | null }[]) {
    const ids = (type: string) => [
      ...new Set(
        rows
          .filter((r) => r.targetType === type && r.targetId !== null && /^\d+$/.test(r.targetId))
          .map((r) => Number(r.targetId)),
      ),
    ];
    const out = new Map<string, string>();
    const banners = ids('promo_banner');
    if (banners.length)
      for (const b of await this.db
        .select({ id: promoBanners.id, title: promoBanners.titleRu })
        .from(promoBanners)
        .where(inArray(promoBanners.id, banners)))
        out.set(`promo_banner:${b.id}`, b.title);
    const frs = ids('fragrance');
    if (frs.length)
      for (const f of await this.db
        .select({ id: fragrances.id, name: fragrances.name })
        .from(fragrances)
        .where(inArray(fragrances.id, frs)))
        out.set(`fragrance:${f.id}`, f.name);
    const vols = ids('volume');
    if (vols.length)
      for (const v of await this.db
        .select({ id: volumes.id, name: fragrances.name })
        .from(volumes)
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(inArray(volumes.id, vols)))
        out.set(`volume:${v.id}`, v.name);
    return out;
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

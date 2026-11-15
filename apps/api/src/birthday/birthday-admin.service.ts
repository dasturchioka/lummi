import {
  adminBirthdayCouponsQuerySchema,
  type AdminBirthdayCouponDto,
  type AdminBirthdayCouponsPageDto,
  type AdminBirthdayCouponsQuery,
} from '@lummi/contracts';
import {
  and,
  birthdayCoupons,
  customers,
  desc,
  eq,
  isNotNull,
  isNull,
  orders,
  sql,
  type Db,
  type SQL,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

/**
 * The birthday coupons as the owner reads them (#55, TZ §3.8 L195): who got one, for which year,
 * whether the message reached the customer (`outbox_id` null = «не доставлено», the coupon stays
 * in the profile), the order that used it and when it ends. Read-only.
 */
@Injectable()
export class BirthdayAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  async list(q: AdminBirthdayCouponsQuery): Promise<AdminBirthdayCouponsPageDto> {
    const query = adminBirthdayCouponsQuerySchema.parse(q);
    const b = birthdayCoupons;
    const where: SQL[] = [];
    if (query.year) where.push(eq(b.birthdayYear, query.year));
    if (query.delivery)
      where.push(query.delivery === 'delivered' ? isNotNull(b.outboxId) : isNull(b.outboxId));
    if (query.used)
      where.push(query.used === 'used' ? isNotNull(b.usedByOrderId) : isNull(b.usedByOrderId));
    const filter = and(...where);

    const [stats] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        notDelivered: sql<number>`count(*) filter (where ${isNull(b.outboxId)})`.mapWith(Number),
      })
      .from(b)
      .where(filter);
    const years = await this.db
      .selectDistinct({ year: b.birthdayYear })
      .from(b)
      .orderBy(desc(b.birthdayYear));
    const rows = await this.db
      .select({
        coupon: b,
        first: customers.firstName,
        last: customers.lastName,
        phone: customers.phone,
        orderNumber: orders.number,
      })
      .from(b)
      .innerJoin(customers, eq(customers.id, b.customerId))
      .leftJoin(orders, eq(orders.id, b.usedByOrderId))
      .where(filter)
      .orderBy(desc(b.issuedAt), desc(b.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const now = this.edges.clock.now();
    const items: AdminBirthdayCouponDto[] = rows.map(({ coupon: c, ...r }) => ({
      id: c.id,
      customerId: c.customerId,
      customerName: [r.first, r.last].filter(Boolean).join(' '),
      phone: r.phone,
      birthdayYear: c.birthdayYear,
      percent: c.percent,
      maxAmount: c.maxAmount,
      issuedAt: c.issuedAt.toISOString(),
      delivered: c.outboxId !== null,
      usedOrderNumber: r.orderNumber,
      expiresAt: c.expiresAt.toISOString(),
      state: c.usedByOrderId !== null ? 'used' : c.expiresAt > now ? 'active' : 'expired',
    }));
    return {
      items,
      total: stats?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
      notDelivered: stats?.notDelivered ?? 0,
      years: years.map((y) => y.year),
    };
  }
}

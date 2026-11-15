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
  not,
  orders,
  outbox,
  sql,
  type Db,
  type SQL,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { customerName } from '../orders/order-read';
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
    // «не доставлено»: no message was queued, or the queued one failed or was suppressed (the
    // customer blocked the bot after it); a pruned outbox row is no failure
    const delivered = and(isNotNull(b.outboxId), isNull(outbox.failedAt))!;
    const where: SQL[] = [];
    if (query.year) where.push(eq(b.birthdayYear, query.year));
    if (query.delivery) where.push(query.delivery === 'delivered' ? delivered : not(delivered));
    if (query.used)
      where.push(query.used === 'used' ? isNotNull(b.usedByOrderId) : isNull(b.usedByOrderId));
    const filter = and(...where);

    const [stats] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        notDelivered: sql<number>`count(*) filter (where ${not(delivered)})`.mapWith(Number),
      })
      .from(b)
      .leftJoin(outbox, eq(outbox.id, b.outboxId))
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
        failed: outbox.failedAt,
      })
      .from(b)
      .innerJoin(customers, eq(customers.id, b.customerId))
      .leftJoin(orders, eq(orders.id, b.usedByOrderId))
      .leftJoin(outbox, eq(outbox.id, b.outboxId))
      .where(filter)
      .orderBy(desc(b.issuedAt), desc(b.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const now = this.edges.clock.now();
    const items: AdminBirthdayCouponDto[] = rows.map(({ coupon: c, ...r }) => ({
      id: c.id,
      customerId: c.customerId,
      customerName: customerName({ firstName: r.first, lastName: r.last }),
      phone: r.phone,
      birthdayYear: c.birthdayYear,
      percent: c.percent,
      maxAmount: c.maxAmount,
      issuedAt: c.issuedAt.toISOString(),
      delivered: c.outboxId !== null && r.failed === null,
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

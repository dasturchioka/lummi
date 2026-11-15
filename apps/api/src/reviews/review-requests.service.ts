import {
  adminReviewRequestsQuerySchema,
  tashkentDayStart,
  type AdminReviewRequestDto,
  type AdminReviewRequestsPageDto,
  type AdminReviewRequestsQuery,
  type ReviewRequestState,
} from '@lummi/contracts';
import { and, customers, desc, eq, isNotNull, orders, sql, type Db, type SQL } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../tokens';

const answered = sql`exists (select 1 from reviews r where r.order_id = ${orders.id})`;

/**
 * The review requests the bot made, as staff read them (#55, TZ §5 L341): `orders.review_request`
 * says `sent` or `not_delivered` (the customer had blocked the bot); a review on the order means
 * the customer answered. Read-only.
 */
@Injectable()
export class ReviewRequestsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(q: AdminReviewRequestsQuery): Promise<AdminReviewRequestsPageDto> {
    const query = adminReviewRequestsQuerySchema.parse(q);
    const days: SQL[] = [isNotNull(orders.reviewRequest)];
    if (query.from)
      days.push(sql`${orders.reviewRequestedAt} >= ${tashkentDayStart(query.from).toISOString()}`);
    if (query.to)
      days.push(sql`${orders.reviewRequestedAt} < ${tashkentDayStart(query.to, 1).toISOString()}`);
    const byState: Record<ReviewRequestState, SQL> = {
      not_delivered: eq(orders.reviewRequest, 'not_delivered'),
      sent: and(eq(orders.reviewRequest, 'sent'), sql`not ${answered}`)!,
      answered: and(eq(orders.reviewRequest, 'sent'), answered)!,
    };
    const where = and(...days, query.state ? byState[query.state] : undefined);

    const [counts] = await this.db
      .select({
        not_delivered: sql<number>`count(*) filter (where ${byState.not_delivered})`.mapWith(
          Number,
        ),
        sent: sql<number>`count(*) filter (where ${byState.sent})`.mapWith(Number),
        answered: sql<number>`count(*) filter (where ${byState.answered})`.mapWith(Number),
      })
      .from(orders)
      .where(and(...days));
    const c = counts ?? { not_delivered: 0, sent: 0, answered: 0 };
    const total = query.state ? c[query.state] : c.not_delivered + c.sent + c.answered;

    const rows = await this.db
      .select({
        number: orders.number,
        first: customers.firstName,
        last: customers.lastName,
        phone: customers.phone,
        recipientPhone: orders.recipientPhone,
        outcome: orders.reviewRequest,
        requestedAt: orders.reviewRequestedAt,
        answered,
        rating: sql<
          number | null
        >`(select r.rating from reviews r where r.order_id = ${orders.id})`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(desc(orders.reviewRequestedAt), desc(orders.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const items: AdminReviewRequestDto[] = rows.map((r) => ({
      orderNumber: r.number,
      customerName: [r.first, r.last].filter(Boolean).join(' '),
      phone: r.phone ?? r.recipientPhone,
      state: r.outcome === 'not_delivered' ? 'not_delivered' : r.answered ? 'answered' : 'sent',
      requestedAt: r.requestedAt!.toISOString(),
      rating: r.rating == null ? null : Number(r.rating),
    }));
    return { items, total, page: query.page, pageSize: query.pageSize, counts: c };
  }
}

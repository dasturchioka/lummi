import {
  adminReviewRequestsQuerySchema,
  type AdminReviewRequestDto,
  type AdminReviewRequestsPageDto,
  type AdminReviewRequestsQuery,
  type ReviewRequestState,
} from '@lummi/contracts';
import { and, customers, desc, eq, isNotNull, orders, reviews, sql, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { within } from '../reports/report-range';
import { DB } from '../tokens';
import { WHO, whoOf } from './reviews.service';

/**
 * A request that went out and its outbox message then failed or was suppressed (the customer
 * blocked the bot after it was queued). The request's buttons carry the order id, which is what
 * ties the message to the order (`reviews-bot.ts`: `rev:r:<order id>:<rating>`).
 */
const lateBlock = sql`exists (
  select 1 from outbox ob
  where ob.kind = 'message' and ob.chat_id = ${customers.telegramId} and ob.failed_at is not null
    and ob.options #>> '{reply_markup,inline_keyboard,0,0,callback_data}' = 'rev:r:' || ${orders.id} || ':1'
)`;

/**
 * The state of a request, the one rule (TZ §5 L341): answered when a review exists; «не доставлено»
 * when the sweep found the customer blocked or the queued message failed; otherwise sent.
 */
const stateOf = sql<ReviewRequestState>`case
  when ${reviews.id} is not null then 'answered'
  when ${orders.reviewRequest} = 'not_delivered' or ${lateBlock} then 'not_delivered'
  else 'sent'
end`;

/** The review requests the bot made, as staff read them (#55). Read-only. */
@Injectable()
export class ReviewRequestsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(q: AdminReviewRequestsQuery): Promise<AdminReviewRequestsPageDto> {
    const query = adminReviewRequestsQuerySchema.parse(q);
    const days = and(isNotNull(orders.reviewRequest), within(orders.reviewRequestedAt, query));
    const base = () =>
      this.db
        .select({
          number: orders.number,
          ...WHO,
          state: stateOf.as('state'),
          requestedAt: orders.reviewRequestedAt,
          rating: reviews.rating,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .leftJoin(reviews, eq(reviews.orderId, orders.id))
        .where(days);

    // the states over the days filter, then the page of the state asked for
    const all = base().as('requests');
    const [counts] = await this.db
      .select({
        not_delivered: sql<number>`count(*) filter (where ${all.state} = 'not_delivered')`.mapWith(
          Number,
        ),
        sent: sql<number>`count(*) filter (where ${all.state} = 'sent')`.mapWith(Number),
        answered: sql<number>`count(*) filter (where ${all.state} = 'answered')`.mapWith(Number),
      })
      .from(all);
    const c = counts ?? { not_delivered: 0, sent: 0, answered: 0 };
    const total = query.state ? c[query.state] : c.not_delivered + c.sent + c.answered;

    const rows = await this.db
      .select()
      .from(all)
      .where(query.state ? eq(all.state, query.state) : undefined)
      .orderBy(desc(all.requestedAt), desc(all.number))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const items: AdminReviewRequestDto[] = rows.map((r) => {
      const who = whoOf(r);
      return {
        orderNumber: r.number,
        customerName: who.name,
        phone: who.phone,
        state: r.state,
        requestedAt: r.requestedAt!.toISOString(),
        rating: r.rating ?? null,
      };
    });
    return { items, total, page: query.page, pageSize: query.pageSize, counts: c };
  }
}

import type {
  AdminCustomer,
  AdminCustomerDetail,
  AdminCustomersPage,
  CustomersQuery,
} from '@lummi/contracts';
import {
  customers,
  desc,
  eq,
  orders,
  sql,
  type CustomerRow,
  type Db,
  type SQL,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { fulfilledOrder } from '../orders/fulfilled';
import { DB } from '../tokens';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** First and last name as the panel shows them. */
const nameOf = (c: Pick<CustomerRow, 'firstName' | 'lastName'>) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ');

/**
 * The customers list and page (#27): read only. Orders count is every order the customer placed;
 * total spent is the sum of their Fulfilled orders (`fulfilledOrder`, GLOSSARY), so an unpaid,
 * cancelled or not-yet-delivered order never counts.
 */
@Injectable()
export class CustomersAdminService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Per customer: all orders and the Fulfilled total, in one grouped pass over `orders`. */
  private stats() {
    return this.db
      .select({
        customerId: orders.customerId,
        ordersCount: sql<number>`count(*)`.mapWith(Number).as('orders_count'),
        spent: sql<number>`coalesce(sum(${orders.total}) filter (where ${fulfilledOrder}), 0)`
          .mapWith(Number)
          .as('spent'),
      })
      .from(orders)
      .groupBy(orders.customerId)
      .as('stats');
  }

  private search(q: string | undefined): SQL | undefined {
    if (!q) return undefined;
    const like = `%${escapeLike(q.replace(/^@/, ''))}%`;
    const digits = q.replace(/\D/g, '');
    const parts: SQL[] = [
      sql`concat_ws(' ', ${customers.firstName}, ${customers.lastName}) ilike ${like}`,
      sql`${customers.username} ilike ${like}`,
    ];
    // a phone is searched by its digits, whatever spaces or `+` the staff member typed
    if (digits.length >= 3) parts.push(sql`${customers.phone} like ${`%${digits}%`}`);
    return sql`(${sql.join(parts, sql` or `)})`;
  }

  async list(query: CustomersQuery): Promise<AdminCustomersPage> {
    const stats = this.stats();
    const where = this.search(query.q);
    const spent = sql<number>`coalesce(${stats.spent}, 0)`;
    const count = sql<number>`coalesce(${stats.ordersCount}, 0)`;
    const order =
      query.sort === 'spent'
        ? [desc(spent), desc(customers.id)]
        : query.sort === 'orders'
          ? [desc(count), desc(spent), desc(customers.id)]
          : [desc(customers.createdAt), desc(customers.id)];
    const rows = await this.db
      .select({ customer: customers, ordersCount: count, spent })
      .from(customers)
      .leftJoin(stats, eq(stats.customerId, customers.id))
      .where(where)
      .orderBy(...order)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(customers)
      .where(where);
    return {
      items: rows.map((r) => this.dto(r.customer, Number(r.ordersCount), Number(r.spent))),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: number): Promise<AdminCustomerDetail | null> {
    const [customer] = await this.db.select().from(customers).where(eq(customers.id, id));
    if (!customer) return null;
    const list = await this.db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        total: orders.total,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.customerId, id))
      .orderBy(desc(orders.createdAt), desc(orders.id));
    const [stat] = await this.db
      .select({
        spent:
          sql<number>`coalesce(sum(${orders.total}) filter (where ${fulfilledOrder}), 0)`.mapWith(
            Number,
          ),
      })
      .from(orders)
      .where(eq(orders.customerId, id));
    return {
      ...this.dto(customer, list.length, stat?.spent ?? 0),
      orders: list.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() })),
    };
  }

  private dto(c: CustomerRow, ordersCount: number, totalSpent: number): AdminCustomer {
    return {
      id: c.id,
      telegramId: c.telegramId,
      name: nameOf(c),
      username: c.username,
      phone: c.phone,
      language: c.language,
      botBlocked: c.botBlocked,
      ordersCount,
      totalSpent,
      createdAt: c.createdAt.toISOString(),
    };
  }
}

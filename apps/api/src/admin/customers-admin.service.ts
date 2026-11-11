import type {
  AdminCustomer,
  AdminCustomerDetail,
  AdminCustomersPage,
  CustomersQuery,
} from '@lummi/contracts';
import { customers, desc, eq, orders, sql, type CustomerRow, type Db, type SQL } from '@lummi/db';
import { AuditService } from '../audit/audit.service';
import { isPlausibleBirthDate } from '../birthday/birthday.service';
import type { Edges } from '../edges';
import { Inject, Injectable } from '@nestjs/common';
import { fulfilledTotal } from '../orders/fulfilled';
import { DB, EDGES } from '../tokens';
import { containsIgnoringApostrophes } from '../util/apostrophe-match';

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
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Per customer: all orders and the Fulfilled total, in one grouped pass over `orders`. */
  private stats() {
    return this.db
      .select({
        customerId: orders.customerId,
        ordersCount: sql<number>`count(*)`.mapWith(Number).as('orders_count'),
        spent: fulfilledTotal.as('spent'),
      })
      .from(orders)
      .groupBy(orders.customerId)
      .as('stats');
  }

  private search(q: string | undefined): SQL | undefined {
    if (!q) return undefined;
    const name = q.replace(/^@/, '');
    const digits = q.replace(/\D/g, '');
    const parts: SQL[] = [
      containsIgnoringApostrophes(
        sql`concat_ws(' ', ${customers.firstName}, ${customers.lastName})`,
        name,
      ),
      containsIgnoringApostrophes(customers.username, name),
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
      .select({ spent: fulfilledTotal })
      .from(orders)
      .where(eq(orders.customerId, id));
    return {
      ...this.dto(customer, list.length, stat?.spent ?? 0),
      orders: list.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() })),
    };
  }

  /**
   * The owner corrects the date of birth (TZ §3.8: the customer enters it once, «изменить может
   * только админ»), audited as the fact only (the date is personal data). Like the customer's own
   * entry it needs the account phone, so a record that relink would merge away never holds one.
   * The abuse guard keeps counting from the customer's own entry; a date set here for a customer who
   * had none counts as entered now. A coupon already issued for this birthday year stays, and no
   * second one comes for it (one per year).
   */
  async setBirthDate(
    staffId: number,
    id: number,
    birthDate: string,
  ): Promise<AdminCustomerDetail | 'not_found' | 'invalid_birth_date' | 'phone_required'> {
    const now = this.edges.clock.now();
    if (!isPlausibleBirthDate(birthDate, now)) return 'invalid_birth_date';
    const done = await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(customers).where(eq(customers.id, id)).for('update');
      if (!c) return 'not_found' as const;
      if (!c.phone) return 'phone_required' as const;
      if (c.birthDate === birthDate) return 'ok' as const;
      await tx
        .update(customers)
        .set({ birthDate, birthDateSetAt: c.birthDateSetAt ?? now, updatedAt: now })
        .where(eq(customers.id, id));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: staffId },
        action: 'customer.birth_date_corrected',
        targetType: 'customer',
        targetId: id,
        payload: { changed: true },
      });
      return 'ok' as const;
    });
    if (done !== 'ok') return done;
    const detail = await this.get(id);
    return detail ?? 'not_found';
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
      birthDate: c.birthDate,
      ordersCount,
      totalSpent,
      createdAt: c.createdAt.toISOString(),
    };
  }
}

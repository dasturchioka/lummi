import {
  broadcastDeliveries,
  favourites,
  customers,
  eq,
  sql,
  type CustomerRow,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { languageFromTelegram } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { moveCartData } from '../cart/move-cart';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import type { InitDataUser } from './init-data';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  /** First sign-in creates the customer (language from language_code); later ones refresh the profile only. */
  async signIn(user: InitDataUser, outer?: DbOrTx): Promise<CustomerRow> {
    const run = async (tx: DbOrTx): Promise<CustomerRow> => {
      const profile = {
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        username: user.username ?? null,
        // the bot's /start has no photo_url: only the Mini App's signed one updates it
        ...(user.photo_url === undefined ? {} : { telegramPhotoUrl: user.photo_url }),
      };
      const [created] = await tx
        .insert(customers)
        .values({
          telegramId: user.id,
          ...profile,
          language: languageFromTelegram(user.language_code),
        })
        .onConflictDoNothing({ target: customers.telegramId })
        .returning();
      if (created) {
        await this.audit.record(tx, {
          actor: { type: 'customer', id: created.id },
          action: 'customer.created',
          targetType: 'customer',
          targetId: created.id,
        });
        return created;
      }
      const [updated] = await tx
        .update(customers)
        .set({ ...profile, updatedAt: this.edges.clock.now() })
        .where(eq(customers.telegramId, user.id))
        .returning();
      if (!updated) throw new Error('customer vanished during sign-in');
      return updated;
    };
    return outer ? run(outer) : this.db.transaction(run);
  }

  /** Telegram said the user blocked (403 / my_chat_member kicked) or unblocked the bot. */
  async markBotBlocked(telegramId: number, blocked: boolean, tx: DbOrTx = this.db): Promise<void> {
    await tx
      .update(customers)
      .set({ botBlocked: blocked })
      .where(eq(customers.telegramId, telegramId));
  }

  async getById(id: number): Promise<CustomerRow | null> {
    const [row] = await this.db.select().from(customers).where(eq(customers.id, id));
    return row ?? null;
  }

  async updatePreferences(
    id: number,
    prefs: { language?: CustomerRow['language']; theme?: CustomerRow['theme'] },
  ): Promise<CustomerRow | null> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!before) return null;
      const [row] = await tx
        .update(customers)
        .set({ ...prefs, updatedAt: this.edges.clock.now() })
        .where(eq(customers.id, id))
        .returning();
      if (row && (row.language !== before.language || row.theme !== before.theme)) {
        await this.audit.record(tx, {
          actor: { type: 'customer', id },
          action: 'customer.preferences_changed',
          targetType: 'customer',
          targetId: id,
          payload: {
            from: { language: before.language, theme: before.theme },
            to: { language: row.language, theme: row.theme },
          },
        });
      }
      return row ?? null;
    });
  }

  /**
   * Set the account phone from a VERIFIED contact (the caller has checked the proof, ADR 0004/0032).
   *
   * - Nobody holds the phone: this customer gets it.
   * - Another customer holds it and this record is fresh (no phone yet): relink. The older customer
   *   takes over this Telegram id and this chat's state; this record is merged away
   *   (`moveCustomerData`), and `relinkedTo` tells the caller to issue a session for the older one.
   * - Another customer holds it and this one already has a phone: `taken`. Nothing changes; the
   *   customer should talk to a manager.
   *
   * Concurrent verifications of one phone race on the unique index; the loser retries and lands on
   * a branch above.
   */
  async setVerifiedPhone(
    customerId: number,
    phone: string,
  ): Promise<
    { kind: 'ok'; customer: CustomerRow; relinkedTo: number | null } | { kind: 'taken' } | null
  > {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction((tx) => this.setPhoneIn(tx, customerId, phone));
      } catch (e) {
        if (attempt >= 3 || !isRetryable(e)) throw e;
      }
    }
  }

  private async setPhoneIn(tx: DbOrTx, customerId: number, phone: string) {
    const [current] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!current) return null;
    const now = this.edges.clock.now();
    const [holder] = await tx.select().from(customers).where(eq(customers.phone, phone));

    if (!holder || holder.id === current.id) {
      if (current.phone === phone)
        return { kind: 'ok' as const, customer: current, relinkedTo: null };
      const [row] = await tx
        .update(customers)
        .set({ phone, phoneVerifiedAt: now, updatedAt: now })
        .where(eq(customers.id, current.id))
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'customer', id: current.id },
        action: 'customer.phone_set',
        targetType: 'customer',
        targetId: current.id,
        payload: { previous: current.phone !== null },
      });
      return { kind: 'ok' as const, customer: row!, relinkedTo: null };
    }

    // Another Telegram id held this phone: the person moved to a new account, phone wins.
    // Only a fresh record may be absorbed; one with its own phone (and so history) may not.
    if (current.phone !== null) return { kind: 'taken' as const };
    await moveCustomerData(tx, current.id, holder.id, now);
    await tx.delete(customers).where(eq(customers.id, current.id));
    const [row] = await tx
      .update(customers)
      .set({
        telegramId: current.telegramId,
        firstName: current.firstName,
        lastName: current.lastName,
        username: current.username,
        // the chat state belongs to the Telegram account now in use, not the abandoned one
        botBlocked: current.botBlocked,
        writeAccess: current.writeAccess,
        phoneVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(customers.id, holder.id))
      .returning();
    await this.audit.record(tx, {
      actor: { type: 'customer', id: holder.id },
      action: 'customer.relinked',
      targetType: 'customer',
      targetId: holder.id,
      payload: {
        fromTelegramId: holder.telegramId,
        toTelegramId: current.telegramId,
        mergedCustomerId: current.id,
      },
    });
    return { kind: 'ok' as const, customer: row!, relinkedTo: holder.id };
  }

  /**
   * The customer's own report of the requestWriteAccess answer. Only `write_access` changes:
   * `bot_blocked` stays what the bot observed (a grant must not hide a real 403). The outbox skips
   * customers who refused or blocked, so statuses stay in the app.
   */
  async recordWriteAccess(id: number, allowed: boolean): Promise<CustomerRow | null> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!before) return null;
      const writeAccess = allowed ? ('granted' as const) : ('refused' as const);
      const [row] = await tx
        .update(customers)
        .set({ writeAccess, updatedAt: this.edges.clock.now() })
        .where(eq(customers.id, id))
        .returning();
      if (before.writeAccess !== writeAccess) {
        await this.audit.record(tx, {
          actor: { type: 'customer', id },
          action: allowed ? 'customer.write_access_granted' : 'customer.write_access_refused',
          targetType: 'customer',
          targetId: id,
        });
      }
      return row ?? null;
    });
  }

  /** /start in the private chat: the customer opened the chat themselves, so the bot may write (recorded as a grant). */
  async markStarted(telegramId: number, tx: DbOrTx = this.db): Promise<void> {
    await tx
      .update(customers)
      .set({
        botBlocked: false,
        writeAccess: 'granted',
      })
      .where(eq(customers.telegramId, telegramId));
  }

  /**
   * False for a customer who refused write access or blocked the bot; true for anyone else. Pass the
   * caller's transaction when it holds one, so the read never waits for a second pool connection.
   */
  async canMessage(telegramId: number, tx: DbOrTx = this.db): Promise<boolean> {
    const [c] = await tx
      .select({ botBlocked: customers.botBlocked, writeAccess: customers.writeAccess })
      .from(customers)
      .where(eq(customers.telegramId, telegramId));
    return !c || (!c.botBlocked && c.writeAccess !== 'refused');
  }
}

/**
 * Customers a broadcast may reach: the bot is known to be able to start the conversation (they
 * pressed /start or granted write access) and has not been blocked. Stricter than `canMessage`,
 * which lets an order status try a customer whose answer is still unknown; a customer this
 * accepts is always one `canMessage` accepts (a test keeps the two in step).
 */
export const broadcastReachableSql = sql`(${customers.botBlocked} = false and ${customers.writeAccess} = 'granted')`;

/**
 * Everything that hangs on a customer record moves here when a fresh record is merged into the
 * older one at relink (ADR 0032). Each ticket that adds a table with a `customer_id` extends this
 * (the cart, #18, moves its lines, discount choice and promo code; favourites, #45, join the older
 * record's; preferences stay with the older record).
 * Orders and data consent never move: only a record without a phone is merged away, and an order
 * needs the account phone (#23), so such a record has neither. Nor a date of birth or a birthday
 * coupon (#30): entering the date needs the account phone, and the job issues only to such records.
 */
export async function moveCustomerData(
  tx: DbOrTx,
  fromId: number,
  toId: number,
  now: Date,
): Promise<void> {
  await moveCartData(tx, fromId, toId, now);
  // Favourites (#45): the older record keeps its own; the rest join it, a repeat counts once.
  await tx.execute(sql`
    insert into favourites (customer_id, kind, fragrance_id, created_at)
    select ${toId}, kind, fragrance_id, created_at from favourites where customer_id = ${fromId}
    on conflict do nothing
  `);
  await tx.delete(favourites).where(eq(favourites.customerId, fromId));
  // A finished broadcast keeps its counts; on a (broadcast, customer) clash the older customer's row wins.
  await tx.execute(sql`
    insert into broadcast_deliveries (broadcast_id, customer_id, status, queued_at, sending_at, sent_at, error)
    select broadcast_id, ${toId}, status, queued_at, sending_at, sent_at, error
    from broadcast_deliveries where customer_id = ${fromId}
    on conflict (broadcast_id, customer_id) do nothing
  `);
  await tx.delete(broadcastDeliveries).where(eq(broadcastDeliveries.customerId, fromId));
}

/** A lost race on the phone's unique index, or a deadlock between two relinks: run the transaction again. */
function isRetryable(e: unknown): boolean {
  const codes = new Set(['23505', '40P01', '40001']);
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && codes.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

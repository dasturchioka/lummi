import { customers, eq, type CustomerRow, type Db, type DbOrTx } from '@lummi/db';
import { languageFromTelegram } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
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
   * Set the account phone from a VERIFIED contact (the caller has checked the proof, ADR 0004).
   * A phone held by another customer relinks that customer to this Telegram id: the older
   * record keeps its orders and rights, this fresh one is merged away. `relinkedTo` is set then,
   * and the caller must hand the client a session for it.
   */
  async setVerifiedPhone(
    customerId: number,
    phone: string,
  ): Promise<{ customer: CustomerRow; relinkedTo: number | null } | null> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (!current) return null;
      const now = this.edges.clock.now();
      const actor = { type: 'customer' as const, id: customerId };
      const [holder] = await tx.select().from(customers).where(eq(customers.phone, phone));

      if (!holder || holder.id === current.id) {
        if (current.phone === phone) return { customer: current, relinkedTo: null };
        const [row] = await tx
          .update(customers)
          .set({ phone, phoneVerifiedAt: now, updatedAt: now })
          .where(eq(customers.id, current.id))
          .returning();
        await this.audit.record(tx, {
          actor,
          action: 'customer.phone_set',
          targetType: 'customer',
          targetId: current.id,
          payload: { previous: current.phone !== null },
        });
        return { customer: row!, relinkedTo: null };
      }

      // Another Telegram id held this phone: the person moved to a new account. Phone wins.
      await tx.delete(customers).where(eq(customers.id, current.id));
      const [row] = await tx
        .update(customers)
        .set({
          telegramId: current.telegramId,
          firstName: current.firstName,
          lastName: current.lastName,
          username: current.username,
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
      return { customer: row!, relinkedTo: holder.id };
    });
  }

  /**
   * The answer to requestWriteAccess. Refusing never blocks ordering: it only flags the customer
   * (bot_blocked) so statuses stay in the app. Granting clears the flag.
   */
  async recordWriteAccess(id: number, allowed: boolean): Promise<CustomerRow | null> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!before) return null;
      const writeAccess = allowed ? ('granted' as const) : ('refused' as const);
      const [row] = await tx
        .update(customers)
        .set({ writeAccess, botBlocked: !allowed, updatedAt: this.edges.clock.now() })
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
}

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
}

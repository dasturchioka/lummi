import { customers, eq, type CustomerRow, type Db } from '@lummi/db';
import { languageFromTelegram } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DB } from '../tokens';
import type { InitDataUser } from './init-data';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** First sign-in creates the customer (language from language_code); later ones refresh the profile only. */
  async signIn(user: InitDataUser): Promise<CustomerRow> {
    return this.db.transaction(async (tx) => {
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
        .set({ ...profile, updatedAt: new Date() })
        .where(eq(customers.telegramId, user.id))
        .returning();
      return updated!;
    });
  }

  async getById(id: number): Promise<CustomerRow | null> {
    const [row] = await this.db.select().from(customers).where(eq(customers.id, id));
    return row ?? null;
  }
}

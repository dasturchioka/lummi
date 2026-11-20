import { maskCardNumber, type AdminShopCardDto } from '@lummi/contracts';
import { shopCard, type Db, type DbOrTx, type ShopCardRow, type StaffRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';

/** The card shoppers transfer to; null while none is set (checkout is then closed, #28). */
export async function readShopCard(db: DbOrTx): Promise<ShopCardRow | null> {
  const [row] = await db.select().from(shopCard);
  return row ?? null;
}

/** A card number's last 4 digits: what a Humo credit shows of the card it went to. */
export const lastFour = (card: Pick<ShopCardRow, 'number'>) => card.number.slice(-4);

/** How the audit log keeps a card: the number masked, the holder as typed. */
const audited = (c: Pick<ShopCardRow, 'number' | 'holder'>) => ({
  number: maskCardNumber(c.number),
  holder: c.holder,
});

const toDto = (c: ShopCardRow | null): AdminShopCardDto => ({
  card: c ? { number: c.number, holder: c.holder, updatedAt: c.updatedAt.toISOString() } : null,
});

/**
 * The shop card, owner-only (spec §4: «Реквизиты карты меняет только владелец; изменения в
 * журнале»). Every change is audited with the actor, old and new, the numbers masked; a save
 * that changes nothing writes nothing, like a setting.
 */
@Injectable()
export class ShopCardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(): Promise<AdminShopCardDto> {
    return toDto(await readShopCard(this.db));
  }

  async set(actor: StaffRow, input: { number: string; holder: string }): Promise<AdminShopCardDto> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(shopCard).for('update');
      if (old && old.number === input.number && old.holder === input.holder) return toDto(old);
      const now = this.edges.clock.now();
      const values = { number: input.number, holder: input.holder, updatedAt: now };
      const [row] = await tx
        .insert(shopCard)
        .values(values)
        .onConflictDoUpdate({ target: shopCard.id, set: values })
        .returning();
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'shop_card.changed',
        targetType: 'shop_card',
        payload: { old: old ? audited(old) : null, new: audited(input) },
      });
      return toDto(row ?? null);
    });
  }

  async clear(actor: StaffRow): Promise<AdminShopCardDto> {
    return this.db.transaction(async (tx) => {
      const [old] = await tx.delete(shopCard).returning();
      if (old)
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'shop_card.cleared',
          targetType: 'shop_card',
          payload: { old: audited(old) },
        });
      return toDto(null);
    });
  }
}

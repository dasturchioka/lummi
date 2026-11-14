import { staffLinkStartParam } from '@lummi/contracts';
import {
  and,
  eq,
  isNull,
  staff,
  staffTelegramLinks,
  type Db,
  type DbOrTx,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { DEV_BOT_LINK, type Env } from '../env';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export type BindResult =
  { result: 'linked'; staff: StaffRow } | { result: 'invalid' | 'taken' | 'inactive' };

/**
 * «Привязать Telegram» (ADR 0038): a staff member's one-time bot link. The panel asks for it with
 * the member's session; opening it in Telegram proves the account, and the bot binds it. A link
 * works once, until `auth.telegramLinkTtlSeconds` runs out; a newer one replaces it. A Telegram
 * account bound to another member is refused, and that refusal does not use the link up.
 */
@Injectable()
export class StaffTelegramLinks {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async create(
    member: StaffRow,
  ): Promise<{ ok: true; url: string; expiresAt: Date } | { ok: false; reason: 'already_linked' }> {
    if (member.telegramId !== null) return { ok: false, reason: 'already_linked' };
    const ttl = await this.settings.get('auth.telegramLinkTtlSeconds');
    const expiresAt = new Date(this.edges.clock.now().getTime() + ttl * 1000);
    const token = randomBytes(24).toString('base64url');
    await this.db.transaction(async (tx) => {
      await tx
        .delete(staffTelegramLinks)
        .where(and(eq(staffTelegramLinks.staffId, member.id), isNull(staffTelegramLinks.usedAt)));
      await tx
        .insert(staffTelegramLinks)
        .values({ staffId: member.id, tokenHash: hash(token), expiresAt });
    });
    const base = (this.env.BOT_LINK ?? DEV_BOT_LINK).replace(/\/$/, '');
    return { ok: true, url: `${base}?start=${staffLinkStartParam(token)}`, expiresAt };
  }

  /** The bot's `/start staff_<token>` from `telegramId`, in the update's transaction. */
  async bind(tx: DbOrTx, token: string, telegramId: number): Promise<BindResult> {
    const now = this.edges.clock.now();
    const [link] = await tx
      .select()
      .from(staffTelegramLinks)
      .where(eq(staffTelegramLinks.tokenHash, hash(token)))
      .for('update');
    if (!link || link.usedAt || link.expiresAt <= now) return { result: 'invalid' };
    const [member] = await tx.select().from(staff).where(eq(staff.id, link.staffId)).for('update');
    if (!member) return { result: 'invalid' };
    if (!member.active) return { result: 'inactive' };
    if (member.telegramId !== null && member.telegramId !== telegramId)
      return { result: 'invalid' };
    const [holder] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.telegramId, telegramId));
    if (holder && holder.id !== member.id) return { result: 'taken' };

    const [bound] = await tx
      .update(staff)
      .set({ telegramId, updatedAt: now })
      .where(eq(staff.id, member.id))
      .returning();
    await tx
      .update(staffTelegramLinks)
      .set({ usedAt: now })
      .where(eq(staffTelegramLinks.id, link.id));
    if (member.telegramId === null) {
      await this.audit.record(tx, {
        actor: { type: 'staff', id: member.id },
        action: 'staff.telegram_linked',
        targetType: 'staff',
        targetId: member.id,
        payload: { name: member.name, telegramId },
      });
    }
    return { result: 'linked', staff: bound as StaffRow };
  }
}

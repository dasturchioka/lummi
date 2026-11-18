import { MAX_PHOTO_BYTES } from '@lummi/contracts';
import { and, auditLog, customers, eq, gte, sql, staff, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { deleteProfilePhotoFiles, storeProfilePhoto } from './profile-photo-pipeline';

/** Whose photo: a customer's own (Mini App) or a staff member's own (admin «Профиль»). Never anyone else's. */
export type ProfilePhotoOwner = { kind: 'customer' | 'staff'; id: number };
export type ProfilePhotoSource = 'upload' | 'telegram' | 'removed';
export type ProfilePhotoResult =
  | { ok: true; photo: string | null }
  | { ok: false; reason: 'not_found' | 'invalid' | 'no_telegram_photo' | 'too_many' };

/**
 * Profile photos (#67): one rule for customers and staff. A change is throttled per owner
 * (`photos.changesPerHour`, counted from the audit entries), the new renditions are written
 * first, then the owner's key and an audit entry (`customer.photo_changed` / `staff.photo_changed`)
 * change in one transaction, then the owner's old renditions are deleted. Names are random and
 * never shared, so a delete can only ever touch the owner's own files.
 */
@Injectable()
export class ProfilePhotoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async upload(owner: ProfilePhotoOwner, bytes: Uint8Array): Promise<ProfilePhotoResult> {
    const gate = await this.gate(owner);
    if (gate) return gate;
    const stored = await storeProfilePhoto(this.edges.files, bytes);
    if (!stored) return { ok: false, reason: 'invalid' };
    return this.apply(owner, stored.key, 'upload');
  }

  /**
   * Take the owner's Telegram photo: the server fetches it itself. A customer's signed `photo_url`
   * first, then the bot's getUserProfilePhotos; a staff member's only through the bot, and only
   * with a linked Telegram. The client never sends a URL. Same image check as an upload.
   */
  async fromTelegram(owner: ProfilePhotoOwner): Promise<ProfilePhotoResult> {
    const known = await this.telegramSource(owner);
    if (!known) return { ok: false, reason: 'not_found' };
    const gate = await this.gate(owner);
    if (gate) return gate;
    let stored: { key: string } | null = null;
    if (known.photoUrl) {
      const got = await this.edges.telegramFiles.downloadUrl(known.photoUrl, MAX_PHOTO_BYTES);
      if (got.kind === 'ok') stored = await storeProfilePhoto(this.edges.files, got.bytes);
    }
    if (!stored && known.telegramId !== null) {
      const fileId = await this.edges.telegram.profilePhotoFileId(known.telegramId);
      if (fileId) {
        const got = await this.edges.telegramFiles.download(fileId, MAX_PHOTO_BYTES);
        if (got.kind === 'ok') stored = await storeProfilePhoto(this.edges.files, got.bytes);
      }
    }
    if (!stored) return { ok: false, reason: 'no_telegram_photo' };
    return this.apply(owner, stored.key, 'telegram');
  }

  async remove(owner: ProfilePhotoOwner): Promise<ProfilePhotoResult> {
    const gate = await this.gate(owner);
    if (gate) return gate;
    return this.apply(owner, null, 'removed');
  }

  /** Not found, or over the hourly limit; null when the change may go ahead. */
  private async gate(owner: ProfilePhotoOwner): Promise<ProfilePhotoResult | null> {
    if (!(await this.telegramSource(owner))) return { ok: false, reason: 'not_found' };
    const limit = await this.settings.get('photos.changesPerHour');
    const since = new Date(this.edges.clock.now().getTime() - 3_600_000);
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, `${owner.kind}.photo_changed`),
          eq(auditLog.actorId, owner.id),
          gte(auditLog.createdAt, since),
        ),
      );
    return (row?.n ?? 0) >= limit ? { ok: false, reason: 'too_many' } : null;
  }

  private async telegramSource(
    owner: ProfilePhotoOwner,
  ): Promise<{ photoUrl: string | null; telegramId: number | null } | null> {
    if (owner.kind === 'customer') {
      const [c] = await this.db.select().from(customers).where(eq(customers.id, owner.id));
      return c ? { photoUrl: c.telegramPhotoUrl, telegramId: c.telegramId } : null;
    }
    const [s] = await this.db.select().from(staff).where(eq(staff.id, owner.id));
    return s ? { photoUrl: null, telegramId: s.telegramId } : null;
  }

  private async apply(
    owner: ProfilePhotoOwner,
    next: string | null,
    source: ProfilePhotoSource,
  ): Promise<ProfilePhotoResult> {
    const table = owner.kind === 'customer' ? customers : staff;
    const done = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ photoKey: table.photoKey })
        .from(table)
        .where(eq(table.id, owner.id))
        .for('update');
      if (!row) return null;
      if (row.photoKey !== next) {
        await tx
          .update(table)
          .set({ photoKey: next, updatedAt: this.edges.clock.now() })
          .where(eq(table.id, owner.id));
        await this.audit.record(tx, {
          actor: { type: owner.kind, id: owner.id },
          action: `${owner.kind}.photo_changed`,
          targetType: owner.kind,
          targetId: owner.id,
          payload: { photo: [row.photoKey, next], source },
        });
      }
      return { old: row.photoKey };
    });
    if (!done) {
      if (next) await deleteProfilePhotoFiles(this.edges.files, next);
      return { ok: false, reason: 'not_found' };
    }
    if (done.old && done.old !== next) await deleteProfilePhotoFiles(this.edges.files, done.old);
    return { ok: true, photo: next };
  }
}

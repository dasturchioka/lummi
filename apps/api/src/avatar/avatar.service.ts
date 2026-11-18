import { MAX_PHOTO_BYTES } from '@lummi/contracts';
import { customers, eq, staff, type Db } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { deleteAvatarIfUnused } from './avatar-cleanup';
import { storeAvatar } from './avatar-pipeline';

/** Whose photo: a customer's own (Mini App) or a staff member's own (admin «Профиль»). Never anyone else's. */
export type AvatarOwner = { kind: 'customer' | 'staff'; id: number };
export type AvatarSource = 'upload' | 'telegram' | 'removed';
export type AvatarResult =
  | { ok: true; photo: string | null }
  | { ok: false; reason: 'not_found' | 'invalid' | 'no_telegram_photo' };

/**
 * Profile photos (#67): one rule for customers and staff. The new renditions are written first,
 * then the owner's hash and an audit entry (`customer.photo_changed` / `staff.photo_changed`)
 * change in one transaction, then the old renditions are deleted unless someone else still uses
 * them (the same photo from two people shares files).
 */
@Injectable()
export class AvatarService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async upload(owner: AvatarOwner, bytes: Uint8Array): Promise<AvatarResult> {
    if (!(await this.exists(owner))) return { ok: false, reason: 'not_found' };
    const stored = await storeAvatar(this.edges.files, bytes);
    if (!stored) return { ok: false, reason: 'invalid' };
    return this.apply(owner, stored.hash, 'upload');
  }

  /**
   * Take the owner's Telegram photo: the server fetches it itself. A customer's signed `photo_url`
   * first, then the bot's getUserProfilePhotos; a staff member's only through the bot, and only
   * with a linked Telegram. The client never sends a URL.
   */
  async fromTelegram(owner: AvatarOwner): Promise<AvatarResult> {
    const known = await this.telegramSource(owner);
    if (!known) return { ok: false, reason: 'not_found' };
    let bytes: Uint8Array | null = null;
    if (known.photoUrl) {
      const got = await this.edges.telegramFiles.downloadUrl(known.photoUrl, MAX_PHOTO_BYTES);
      if (got.kind === 'ok') bytes = got.bytes;
    }
    if (!bytes && known.telegramId !== null) {
      const fileId = await this.edges.telegram.profilePhotoFileId(known.telegramId);
      if (fileId) {
        const got = await this.edges.telegramFiles.download(fileId, MAX_PHOTO_BYTES);
        if (got.kind === 'ok') bytes = got.bytes;
      }
    }
    if (!bytes) return { ok: false, reason: 'no_telegram_photo' };
    const stored = await storeAvatar(this.edges.files, bytes);
    if (!stored) return { ok: false, reason: 'no_telegram_photo' };
    return this.apply(owner, stored.hash, 'telegram');
  }

  async remove(owner: AvatarOwner): Promise<AvatarResult> {
    return this.apply(owner, null, 'removed');
  }

  private async exists(owner: AvatarOwner): Promise<boolean> {
    return (await this.telegramSource(owner)) !== null;
  }

  private async telegramSource(
    owner: AvatarOwner,
  ): Promise<{ photoUrl: string | null; telegramId: number | null } | null> {
    if (owner.kind === 'customer') {
      const [c] = await this.db.select().from(customers).where(eq(customers.id, owner.id));
      return c ? { photoUrl: c.telegramPhotoUrl, telegramId: c.telegramId } : null;
    }
    const [s] = await this.db.select().from(staff).where(eq(staff.id, owner.id));
    return s ? { photoUrl: null, telegramId: s.telegramId } : null;
  }

  private async apply(
    owner: AvatarOwner,
    next: string | null,
    source: AvatarSource,
  ): Promise<AvatarResult> {
    const table = owner.kind === 'customer' ? customers : staff;
    const done = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ photoHash: table.photoHash })
        .from(table)
        .where(eq(table.id, owner.id))
        .for('update');
      if (!row) return null;
      if (row.photoHash !== next) {
        await tx
          .update(table)
          .set({ photoHash: next, updatedAt: this.edges.clock.now() })
          .where(eq(table.id, owner.id));
        await this.audit.record(tx, {
          actor: { type: owner.kind, id: owner.id },
          action: `${owner.kind}.photo_changed`,
          targetType: owner.kind,
          targetId: owner.id,
          payload: { photo: [row.photoHash, next], source },
        });
      }
      return { old: row.photoHash };
    });
    if (!done) {
      if (next) await deleteAvatarIfUnused(this.db, this.edges.files, next);
      return { ok: false, reason: 'not_found' };
    }
    if (done.old && done.old !== next)
      await deleteAvatarIfUnused(this.db, this.edges.files, done.old);
    return { ok: true, photo: next };
  }
}

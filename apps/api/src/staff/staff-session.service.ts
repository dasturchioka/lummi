import {
  and,
  eq,
  gt,
  isNull,
  ne,
  staff,
  staffSessions,
  type DbOrTx,
  type StaffRow,
  type Db,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import type { Edges } from '../edges';

export const STAFF_COOKIE = 'lummi_admin';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Server-side admin sessions (ADR 0017): an opaque random token in the cookie, its hash in the DB. */
@Injectable()
export class StaffSessionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async issue(staffId: number): Promise<{ token: string; expiresAt: Date; maxAgeSeconds: number }> {
    const maxAgeSeconds = await this.settings.get('auth.staffSessionTtlSeconds');
    const expiresAt = new Date(this.edges.clock.now().getTime() + maxAgeSeconds * 1000);
    const token = randomBytes(32).toString('base64url');
    await this.db.insert(staffSessions).values({ staffId, tokenHash: hash(token), expiresAt });
    return { token, expiresAt, maxAgeSeconds };
  }

  /** The active staff member behind a live (unexpired, unrevoked) session, else null. */
  async resolve(token: string): Promise<StaffRow | null> {
    const [row] = await this.db
      .select({ staff })
      .from(staffSessions)
      .innerJoin(staff, eq(staff.id, staffSessions.staffId))
      .where(
        and(
          eq(staffSessions.tokenHash, hash(token)),
          isNull(staffSessions.revokedAt),
          gt(staffSessions.expiresAt, this.edges.clock.now()),
          eq(staff.active, true),
        ),
      );
    return row?.staff ?? null;
  }

  async revoke(token: string): Promise<void> {
    await this.db
      .update(staffSessions)
      .set({ revokedAt: this.edges.clock.now() })
      .where(and(eq(staffSessions.tokenHash, hash(token)), isNull(staffSessions.revokedAt)));
  }

  /** Pass the transaction so a deactivation and its revocation commit together. */
  async revokeAll(tx: DbOrTx, staffId: number): Promise<void> {
    await tx
      .update(staffSessions)
      .set({ revokedAt: this.edges.clock.now() })
      .where(and(eq(staffSessions.staffId, staffId), isNull(staffSessions.revokedAt)));
  }

  /** A password change: every session of the member but the one it was made in ends. */
  async revokeOthers(tx: DbOrTx, staffId: number, keepToken: string): Promise<void> {
    await tx
      .update(staffSessions)
      .set({ revokedAt: this.edges.clock.now() })
      .where(
        and(
          eq(staffSessions.staffId, staffId),
          isNull(staffSessions.revokedAt),
          ne(staffSessions.tokenHash, hash(keepToken)),
        ),
      );
  }
}

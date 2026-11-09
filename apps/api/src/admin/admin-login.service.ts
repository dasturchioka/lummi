import type { LoginWidgetBody } from '@lummi/contracts';
import type { Db, StaffRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { SettingsService } from '../settings/settings.service';
import { StaffSessionService } from '../staff/staff-session.service';
import { StaffService } from '../staff/staff.service';
import { DB, EDGES, ENV } from '../tokens';
import { LoginWidgetError, verifyLoginWidget } from './login-widget';

export type LoginResult =
  | { ok: true; staff: StaffRow; token: string; maxAgeSeconds: number }
  | { ok: false; status: 401; code: 'invalid_login' | 'expired_login' }
  | { ok: false; status: 403; code: 'no_access' };

/** Turns a proven identity (widget payload or, in dev, a Telegram id) into a staff session. */
@Injectable()
export class AdminLoginService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  async withWidget(body: LoginWidgetBody): Promise<LoginResult> {
    let user;
    try {
      user = verifyLoginWidget(body, {
        botToken: this.env.BOT_TOKEN,
        now: this.edges.clock.now(),
        maxAgeSeconds: await this.settings.get('auth.loginWidgetMaxAgeSeconds'),
        maxFutureSkewSeconds: await this.settings.get('auth.loginWidgetMaxFutureSkewSeconds'),
      });
    } catch (e) {
      if (!(e instanceof LoginWidgetError)) throw e;
      const expired = e.reason === 'stale' || e.reason === 'future';
      return { ok: false, status: 401, code: expired ? 'expired_login' : 'invalid_login' };
    }
    return this.signIn(user.id);
  }

  /** Callers must check `ADMIN_DEV_LOGIN` first. */
  withTelegramId(telegramId: number): Promise<LoginResult> {
    return this.signIn(telegramId);
  }

  private async signIn(telegramId: number): Promise<LoginResult> {
    const member = await this.staff.findByTelegramId(telegramId);
    if (!member || !member.active) return { ok: false, status: 403, code: 'no_access' };
    const session = await this.sessions.issue(member.id);
    await this.audit.record(this.db, {
      actor: { type: 'staff', id: member.id },
      action: 'staff.signed_in',
      targetType: 'staff',
      targetId: member.id,
    });
    return { ok: true, staff: member, token: session.token, maxAgeSeconds: session.maxAgeSeconds };
  }
}

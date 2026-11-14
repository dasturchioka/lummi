import { normalizeLogin, STAFF_LOGIN_PATTERN, type LoginWidgetBody } from '@lummi/contracts';
import type { Db, StaffRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { SettingsService } from '../settings/settings.service';
import { LoginThrottle, type ThrottleKey } from '../staff/login-throttle';
import { verifyPassword } from '../staff/password';
import { StaffSessionService } from '../staff/staff-session.service';
import { StaffService } from '../staff/staff.service';
import { DB, EDGES, ENV } from '../tokens';
import { LoginWidgetError, verifyLoginWidget } from './login-widget';

export type LoginResult =
  | { ok: true; staff: StaffRow; token: string; maxAgeSeconds: number }
  | { ok: false; status: 401; code: 'invalid_login' | 'expired_login' | 'invalid_credentials' }
  | { ok: false; status: 403; code: 'no_access' }
  | { ok: false; status: 429; code: 'locked'; retryAt: Date };

type SignInMethod = 'telegram' | 'password' | 'dev';

/**
 * Turns a proven identity (widget payload, login and password, or in dev a Telegram id) into a
 * staff session.
 */
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
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
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
    return this.signIn(await this.staff.findByTelegramId(user.id), 'telegram');
  }

  /** Callers must check `ADMIN_DEV_LOGIN` first. */
  async withTelegramId(telegramId: number): Promise<LoginResult> {
    return this.signIn(await this.staff.findByTelegramId(telegramId), 'dev');
  }

  /**
   * Login and password (ADR 0038). The attempt is counted first, under a row lock: past the
   * limit, or while a lock runs, it is refused without checking any password. A wrong password,
   * an unknown login and a Telegram-only record answer alike, after the same argon2 work; the
   * wrong guess that reaches a limit locks and says until when.
   */
  async withPassword(
    input: { login: string; password: string },
    address: string,
  ): Promise<LoginResult> {
    const login = normalizeLogin(input.login);
    const keys: ThrottleKey[] = [
      { scope: 'login', key: login },
      { scope: 'ip', key: address },
    ];
    const admission = await this.throttle.admit(keys);
    if (!admission.ok) return this.locked(admission.retryAt);
    const member = STAFF_LOGIN_PATTERN.test(login) ? await this.staff.findByLogin(login) : null;
    const passwordMatches = await verifyPassword(input.password, member?.passwordHash ?? null);
    if (!member || !passwordMatches) {
      const lockedUntil = await this.throttle.fail(keys);
      if (lockedUntil) return this.locked(lockedUntil);
      return { ok: false, status: 401, code: 'invalid_credentials' };
    }
    await this.throttle.succeed(keys);
    return this.signIn(member, 'password');
  }

  private locked(retryAt: Date): LoginResult {
    return { ok: false, status: 429, code: 'locked', retryAt };
  }

  private async signIn(member: StaffRow | null, method: SignInMethod): Promise<LoginResult> {
    if (!member || !member.active) return { ok: false, status: 403, code: 'no_access' };
    const session = await this.sessions.issue(member.id);
    await this.audit.record(this.db, {
      actor: { type: 'staff', id: member.id },
      action: 'staff.signed_in',
      targetType: 'staff',
      targetId: member.id,
      payload: { method },
    });
    return { ok: true, staff: member, token: session.token, maxAgeSeconds: session.maxAgeSeconds };
  }
}

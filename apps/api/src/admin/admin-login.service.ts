import { STAFF_LOGIN_PATTERN, type LoginWidgetBody } from '@lummi/contracts';
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
   * Login and password (ADR 0038). A wrong password, an unknown login and a Telegram-only record
   * answer alike, after the same argon2 work. While the login or the address is locked no
   * password is checked; the failure that reaches a limit locks and says until when.
   */
  async withPassword(
    input: { login: string; password: string },
    address: string,
  ): Promise<LoginResult> {
    const login = input.login.trim().toLowerCase().slice(0, 64);
    const keys: ThrottleKey[] = [
      { scope: 'login', key: login },
      { scope: 'ip', key: address },
    ];
    const lockedUntil = await this.throttle.lockedUntil(keys);
    if (lockedUntil) return this.locked(lockedUntil);
    const member = STAFF_LOGIN_PATTERN.test(login) ? await this.staff.findByLogin(login) : null;
    const right = await verifyPassword(input.password, member?.passwordHash ?? null);
    if (!member || !right) {
      const locks = await this.throttle.fail(keys);
      for (const { key, until } of locks) {
        if (key.scope === 'login' && member) await this.staff.recordLock(this.db, member, until);
        if (key.scope === 'ip') {
          await this.audit.record(this.db, {
            actor: { type: 'system' },
            action: 'auth.address_locked',
            targetType: 'ip',
            targetId: address,
            payload: { until: until.toISOString() },
          });
        }
      }
      const until = locks.map((l) => l.until).sort((a, b) => b.getTime() - a.getTime())[0];
      if (until) return this.locked(until);
      return { ok: false, status: 401, code: 'invalid_credentials' };
    }
    await this.throttle.clear(keys[0]!);
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

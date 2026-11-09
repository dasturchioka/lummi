import { contract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, Req, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { SettingsService } from '../settings/settings.service';
import { CurrentStaff, StaffGuard, readCookie } from '../staff/staff.guard';
import { STAFF_COOKIE, StaffSessionService } from '../staff/staff-session.service';
import { StaffService } from '../staff/staff.service';
import { DB, EDGES, ENV } from '../tokens';
import type { Db } from '@lummi/db';
import { LoginWidgetError, verifyLoginWidget } from './login-widget';
import { toStaffDto } from './staff.dto';

@Controller()
export class AdminAuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  @TsRestHandler(contract.admin.loginWidget)
  loginWidget(@Res({ passthrough: true }) res: Response) {
    return tsRestHandler(contract.admin.loginWidget, async ({ body }) => {
      let user;
      try {
        user = verifyLoginWidget(body, {
          botToken: this.env.BOT_TOKEN,
          now: this.edges.clock.now(),
          maxAgeSeconds: await this.settings.get('auth.loginWidgetMaxAgeSeconds'),
          maxFutureSkewSeconds: await this.settings.get('auth.initDataMaxFutureSkewSeconds'),
        });
      } catch (e) {
        if (!(e instanceof LoginWidgetError)) throw e;
        const expired = e.reason === 'stale' || e.reason === 'future';
        return {
          status: 401 as const,
          body: { code: expired ? ('expired_login' as const) : ('invalid_login' as const) },
        };
      }
      return this.finishLogin(res, await this.staff.findByTelegramId(user.id));
    });
  }

  /** Dev/test only; the env schema refuses to enable it in production. */
  @TsRestHandler(contract.admin.devLogin)
  devLogin(@Res({ passthrough: true }) res: Response) {
    return tsRestHandler(contract.admin.devLogin, async ({ body }) => {
      if (!this.env.ADMIN_DEV_LOGIN)
        return { status: 404 as const, body: { code: 'not_available' as const } };
      return this.finishLogin(res, await this.staff.findByTelegramId(body.telegramId));
    });
  }

  @TsRestHandler(contract.admin.logout)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return tsRestHandler(contract.admin.logout, async () => {
      const token = readCookie(req.headers.cookie, STAFF_COOKIE);
      if (token) await this.sessions.revoke(token);
      res.cookie(STAFF_COOKIE, '', { ...this.cookieOptions(), maxAge: 0 });
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(contract.admin.me)
  @UseGuards(StaffGuard)
  me(@CurrentStaff() member: StaffRow) {
    return tsRestHandler(contract.admin.me, async () => ({
      status: 200 as const,
      body: toStaffDto(member),
    }));
  }

  private async finishLogin(res: Response, member: StaffRow | null) {
    if (!member || !member.active) {
      return { status: 403 as const, body: { code: 'no_access' as const } };
    }
    const session = await this.sessions.issue(member.id);
    await this.audit.record(this.db, {
      actor: { type: 'staff', id: member.id },
      action: 'staff.signed_in',
      targetType: 'staff',
      targetId: member.id,
    });
    res.cookie(STAFF_COOKIE, session.token, {
      ...this.cookieOptions(),
      maxAge: session.maxAgeSeconds * 1000,
    });
    return { status: 200 as const, body: toStaffDto(member) };
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.env.NODE_ENV === 'production',
      path: '/',
    };
  }
}

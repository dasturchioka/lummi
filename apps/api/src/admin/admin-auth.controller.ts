import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, Req, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request, Response } from 'express';
import type { Env } from '../env';
import { clientAddress } from '../staff/client-address';
import { readCookie } from '../staff/cookie';
import { AllowedDuringPasswordChange, CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { STAFF_COOKIE, StaffSessionService } from '../staff/staff-session.service';
import { ENV } from '../tokens';
import { AdminLoginService, type LoginResult } from './admin-login.service';
import { lockedOut } from './password-responses';
import { toStaffDto } from './staff.dto';

@Controller()
export class AdminAuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AdminLoginService) private readonly login: AdminLoginService,
    @Inject(StaffSessionService) private readonly sessions: StaffSessionService,
  ) {}

  @TsRestHandler(adminContract.loginWidget)
  loginWidget(@Res({ passthrough: true }) res: Response) {
    return tsRestHandler(adminContract.loginWidget, async ({ body }) =>
      this.reply(res, await this.login.withWidget(body)),
    );
  }

  /** Login and password (ADR 0038): the panel's main way in. */
  @TsRestHandler(adminContract.passwordLogin)
  passwordLogin(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return tsRestHandler(adminContract.passwordLogin, async ({ body }) =>
      this.reply(res, await this.login.withPassword(body, clientAddress(req))),
    );
  }

  /** Dev/test only; the env schema refuses to enable it in production. */
  @TsRestHandler(adminContract.devLogin)
  devLogin(@Res({ passthrough: true }) res: Response) {
    return tsRestHandler(adminContract.devLogin, async ({ body }) => {
      if (!this.env.ADMIN_DEV_LOGIN) {
        return { status: 404 as const, body: { code: 'not_available' as const } };
      }
      return this.reply(res, await this.login.withTelegramId(body.telegramId));
    });
  }

  @TsRestHandler(adminContract.logout)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return tsRestHandler(adminContract.logout, async () => {
      const token = readCookie(req.headers.cookie, STAFF_COOKIE);
      if (token) await this.sessions.revoke(token);
      res.cookie(STAFF_COOKIE, '', { ...this.cookieOptions(), maxAge: 0 });
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @TsRestHandler(adminContract.me)
  @UseGuards(StaffGuard)
  @AllowedDuringPasswordChange()
  me(@CurrentStaff() member: StaffRow) {
    return tsRestHandler(adminContract.me, async () => ({
      status: 200 as const,
      body: toStaffDto(member),
    }));
  }

  private reply(res: Response, result: LoginResult) {
    if (!result.ok) {
      switch (result.status) {
        case 401:
          return { status: 401 as const, body: { code: result.code } };
        case 403:
          return { status: 403 as const, body: { code: result.code } };
        case 429:
          return lockedOut(result.retryAt);
      }
    }
    res.cookie(STAFF_COOKIE, result.token, {
      ...this.cookieOptions(),
      maxAge: result.maxAgeSeconds * 1000,
    });
    return { status: 200 as const, body: toStaffDto(result.staff) };
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

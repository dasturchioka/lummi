import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import {
  AllowedDuringPasswordChange,
  CurrentStaff,
  CurrentStaffToken,
  StaffGuard,
} from '../staff/staff.guard';
import { StaffService } from '../staff/staff.service';
import { StaffTelegramLinks } from '../staff/telegram-link.service';
import { lockedOut, passwordRefused } from './password-responses';
import { toStaffDto } from './staff.dto';

/** The signed-in member's own account (ADR 0038): any role, identified by the session only. */
@Controller()
@UseGuards(StaffGuard)
export class ProfileController {
  constructor(
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(StaffTelegramLinks) private readonly links: StaffTelegramLinks,
  ) {}

  @TsRestHandler(adminContract.passwordPolicy)
  @AllowedDuringPasswordChange()
  passwordPolicy() {
    return tsRestHandler(adminContract.passwordPolicy, async () => ({
      status: 200 as const,
      body: { minLength: await this.staff.minPasswordLength() },
    }));
  }

  @TsRestHandler(adminContract.changePassword)
  @AllowedDuringPasswordChange()
  changePassword(@CurrentStaff() member: StaffRow, @CurrentStaffToken() token: string) {
    return tsRestHandler(adminContract.changePassword, async ({ body }) => {
      const res = await this.staff.changePassword(member, body, token);
      if (res.ok) return { status: 200 as const, body: toStaffDto(res.staff) };
      if (res.reason === 'locked') return lockedOut(res.retryAt);
      if ('minLength' in res) return passwordRefused(res);
      // login_required: a Telegram-only record (the owner gives it a login with «Сбросить пароль»);
      // conflict: the owner reset the password while this change was being checked
      return { status: 409 as const, body: { code: res.reason } };
    });
  }

  @TsRestHandler(adminContract.telegramLink)
  telegramLink(@CurrentStaff() member: StaffRow) {
    return tsRestHandler(adminContract.telegramLink, async () => {
      const res = await this.links.create(member);
      if (!res.ok) return { status: 409 as const, body: { code: res.reason } };
      return {
        status: 201 as const,
        body: { url: res.url, expiresAt: res.expiresAt.toISOString() },
      };
    });
  }
}

import { Controller, Delete, HttpCode, Inject, Post, Put, Req, UseGuards } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { staff, eq, type Db, type StaffRow } from '@lummi/db';
import { toStaffDto } from '../admin/staff.dto';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { CustomersService } from '../auth/customers.service';
import { readPhotoBody } from '../catalog/photo-upload';
import { toCustomerDto } from '../me/customer.dto';
import { SettingsService } from '../settings/settings.service';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { DB } from '../tokens';
import { AvatarService, type AvatarOwner, type AvatarResult } from './avatar.service';

/** The HTTP error for a refused outcome: 404 for no such record or no Telegram photo, 422 for bytes that are no image. */
function refusal(res: Extract<AvatarResult, { ok: false }>): HttpException {
  if (res.reason === 'invalid') {
    return new HttpException({ code: 'invalid', fields: ['photo'] }, 422);
  }
  return new HttpException({ code: res.reason }, 404);
}

/**
 * The signed-in customer's own photo (#67), by the session only: there is no id in any path, so one
 * customer cannot reach another's. Upload is the raw image bytes, as for catalog photos.
 */
@Controller('me/photo')
@UseGuards(SessionGuard)
export class AvatarController {
  constructor(
    @Inject(AvatarService) private readonly avatars: AvatarService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  private async respond(owner: AvatarOwner, res: AvatarResult) {
    if (!res.ok) throw refusal(res);
    const c = await this.customers.getById(owner.id);
    if (!c) throw new HttpException({ code: 'unauthorized' }, 401);
    return toCustomerDto(c, this.settings);
  }

  @Put()
  async upload(@SessionCustomerId() id: number, @Req() req: Request) {
    const bytes = readPhotoBody(req.body);
    const owner = { kind: 'customer', id } as const;
    return this.respond(owner, await this.avatars.upload(owner, bytes));
  }

  @Post('telegram')
  @HttpCode(200)
  async telegram(@SessionCustomerId() id: number) {
    const owner = { kind: 'customer', id } as const;
    return this.respond(owner, await this.avatars.fromTelegram(owner));
  }

  @Delete()
  async remove(@SessionCustomerId() id: number) {
    const owner = { kind: 'customer', id } as const;
    return this.respond(owner, await this.avatars.remove(owner));
  }
}

/** The signed-in staff member's own avatar (admin «Профиль»), any role, by the session cookie only. */
@Controller('admin/me/photo')
@UseGuards(StaffGuard)
export class AdminAvatarController {
  constructor(
    @Inject(AvatarService) private readonly avatars: AvatarService,
    @Inject(DB) private readonly db: Db,
  ) {}

  private async respond(member: StaffRow, res: AvatarResult) {
    if (!res.ok) throw refusal(res);
    const [row] = await this.db.select().from(staff).where(eq(staff.id, member.id));
    return toStaffDto(row ?? member);
  }

  @Put()
  async upload(@CurrentStaff() member: StaffRow, @Req() req: Request) {
    const bytes = readPhotoBody(req.body);
    return this.respond(member, await this.avatars.upload({ kind: 'staff', id: member.id }, bytes));
  }

  @Post('telegram')
  @HttpCode(200)
  async telegram(@CurrentStaff() member: StaffRow) {
    return this.respond(member, await this.avatars.fromTelegram({ kind: 'staff', id: member.id }));
  }

  @Delete()
  async remove(@CurrentStaff() member: StaffRow) {
    return this.respond(member, await this.avatars.remove({ kind: 'staff', id: member.id }));
  }
}

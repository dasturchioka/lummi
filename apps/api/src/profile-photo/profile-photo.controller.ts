import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Edges } from '../edges';
import { EDGES } from '../tokens';
import { PROFILE_PHOTO_FILE, PROFILE_PHOTO_PREFIX } from './profile-photo-pipeline';
import type { StaffRow } from '@lummi/db';
import { toStaffDto } from '../admin/staff.dto';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { CustomersService } from '../auth/customers.service';
import { readPhotoBody } from '../catalog/photo-upload';
import { toCustomerDto } from '../me/customer.dto';
import { SettingsService } from '../settings/settings.service';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { StaffService } from '../staff/staff.service';
import {
  ProfilePhotoService,
  type ProfilePhotoOwner,
  type ProfilePhotoResult,
} from './profile-photo.service';

/** The HTTP error for a refused outcome: 404 for no such record or no Telegram photo, 422 for bytes that are no image. */
function refusal(res: Extract<ProfilePhotoResult, { ok: false }>): HttpException {
  if (res.reason === 'invalid') {
    return new HttpException({ code: 'invalid', fields: ['photo'] }, 422);
  }
  if (res.reason === 'too_many') return new HttpException({ code: 'too_many' }, 429);
  return new HttpException({ code: res.reason }, 404);
}

/**
 * The signed-in customer's own photo (#67), by the session only: there is no id in any path, so one
 * customer cannot reach another's. Upload is the raw image bytes, as for catalog photos.
 */
@Controller('me/photo')
@UseGuards(SessionGuard)
export class ProfilePhotoController {
  constructor(
    @Inject(ProfilePhotoService) private readonly photos: ProfilePhotoService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  private async respond(owner: ProfilePhotoOwner, res: ProfilePhotoResult) {
    if (!res.ok) throw refusal(res);
    const c = await this.customers.getById(owner.id);
    if (!c) throw new HttpException({ code: 'unauthorized' }, 401);
    return toCustomerDto(c, this.settings);
  }

  @Put()
  async upload(@SessionCustomerId() id: number, @Req() req: Request) {
    const bytes = readPhotoBody(req.body);
    const owner = { kind: 'customer', id } as const;
    return this.respond(owner, await this.photos.upload(owner, bytes));
  }

  @Post('telegram')
  @HttpCode(200)
  async telegram(@SessionCustomerId() id: number) {
    const owner = { kind: 'customer', id } as const;
    return this.respond(owner, await this.photos.fromTelegram(owner));
  }

  @Delete()
  async remove(@SessionCustomerId() id: number) {
    const owner = { kind: 'customer', id } as const;
    return this.respond(owner, await this.photos.remove(owner));
  }
}

/** The signed-in staff member's own profile photo (admin «Профиль»), any role, by the session cookie only. */
@Controller('admin/me/photo')
@UseGuards(StaffGuard)
export class AdminProfilePhotoController {
  constructor(
    @Inject(ProfilePhotoService) private readonly photos: ProfilePhotoService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  private async respond(member: StaffRow, res: ProfilePhotoResult) {
    if (!res.ok) throw refusal(res);
    const row = await this.staff.findById(member.id);
    return toStaffDto(row ?? member);
  }

  @Put()
  async upload(@CurrentStaff() member: StaffRow, @Req() req: Request) {
    const bytes = readPhotoBody(req.body);
    return this.respond(member, await this.photos.upload({ kind: 'staff', id: member.id }, bytes));
  }

  @Post('telegram')
  @HttpCode(200)
  async telegram(@CurrentStaff() member: StaffRow) {
    return this.respond(member, await this.photos.fromTelegram({ kind: 'staff', id: member.id }));
  }

  @Delete()
  async remove(@CurrentStaff() member: StaffRow) {
    return this.respond(member, await this.photos.remove({ kind: 'staff', id: member.id }));
  }
}

/**
 * Profile photos are personal data (#67, ADR 0020 amended): served here, by the API host only,
 * never by `media.<domain>`. The names are random 128-bit values and belong to one person, so the
 * link is a capability; browsers may keep a file for a day, shared caches never.
 */
@Controller('profile-photos')
export class ProfilePhotoMediaController {
  constructor(@Inject(EDGES) private readonly edges: Edges) {}

  @Get(':file')
  async photo(@Param('file') file: string, @Res() res: Response): Promise<void> {
    if (!PROFILE_PHOTO_FILE.test(file)) throw new NotFoundException();
    const data = await this.edges.files.get(`${PROFILE_PHOTO_PREFIX}${file}`);
    if (!data) throw new NotFoundException();
    res
      .status(200)
      .set({
        'content-type': 'image/webp',
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
      })
      .send(Buffer.from(data));
  }
}

import { MAX_PHOTO_BYTES, adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, HttpException, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request } from 'express';
import { looksLikeImage } from '../catalog/photo-pipeline';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { SetsAdminService } from './sets-admin.service';

/** Any active staff member reads the set and counts the boxes; price, composition and photo are the owner's. */
@Controller()
@UseGuards(StaffGuard)
export class SetsAdminController {
  constructor(@Inject(SetsAdminService) private readonly sets: SetsAdminService) {}

  @TsRestHandler(adminContract.sets.get)
  get() {
    return tsRestHandler(adminContract.sets.get, async () => ({
      status: 200 as const,
      body: await this.sets.get(),
    }));
  }

  @TsRestHandler(adminContract.sets.setOnHand)
  setOnHand(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.sets.setOnHand, async ({ body }) => ({
      status: 200 as const,
      body: await this.sets.setOnHand(actor, body.onHand),
    }));
  }

  @UseGuards(OwnerGuard)
  @TsRestHandler(adminContract.sets.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.sets.update, async ({ body }) => {
      const res = await this.sets.update(actor, body);
      return res.ok
        ? { status: 200 as const, body: res.value }
        : { status: 422 as const, body: { code: 'invalid' as const, fields: res.fields } };
    });
  }

  /** Raw image bytes, judged by magic bytes like the bottle photos (ADR 0020). */
  @UseGuards(OwnerGuard)
  @Put('admin/sets/discovery/photo')
  async photo(@CurrentStaff() actor: StaffRow, @Req() req: Request) {
    const body: unknown = req.body;
    const bytes = Buffer.isBuffer(body) ? body : null;
    if (!bytes || bytes.length === 0) {
      throw new HttpException({ code: 'invalid', fields: ['photo'] }, 415);
    }
    if (bytes.length > MAX_PHOTO_BYTES) {
      throw new HttpException({ code: 'invalid', fields: ['photo'] }, 413);
    }
    if (!looksLikeImage(bytes)) {
      throw new HttpException({ code: 'invalid', fields: ['photo'] }, 415);
    }
    const res = await this.sets.setPhoto(actor, bytes);
    if (res.ok) return { photo: res.value };
    throw new HttpException({ code: 'invalid', fields: ['photo'] }, 422);
  }
}

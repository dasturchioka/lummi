import { adminContract, discoveryQuerySchema } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import {
  BadRequestException,
  Controller,
  Inject,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request } from 'express';
import { photoFailure, readPhotoBody } from '../catalog/photo-upload';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { SetsAdminService } from './sets-admin.service';

/** Any active staff member reads the set and counts the boxes; price, composition and photo are the owner's. */
@Controller()
@UseGuards(StaffGuard)
export class SetsAdminController {
  constructor(@Inject(SetsAdminService) private readonly sets: SetsAdminService) {}

  @TsRestHandler(adminContract.sets.get)
  get() {
    return tsRestHandler(adminContract.sets.get, async ({ query }) => ({
      status: 200 as const,
      body: await this.sets.get(query.vialMl),
    }));
  }

  @TsRestHandler(adminContract.sets.setOnHand)
  setOnHand(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.sets.setOnHand, async ({ query, body }) => {
      const res = await this.sets.setOnHand(
        actor,
        query.vialMl,
        body.onHand,
        body.expected,
        body.reason,
      );
      return res.ok
        ? { status: 200 as const, body: res.value }
        : {
            status: 409 as const,
            body: { code: 'on_hand_changed' as const, current: res.current },
          };
    });
  }

  @UseGuards(OwnerGuard)
  @TsRestHandler(adminContract.sets.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.sets.update, async ({ query, body }) => {
      const res = await this.sets.update(actor, query.vialMl, body);
      return res.ok
        ? { status: 200 as const, body: res.value }
        : { status: 422 as const, body: { code: 'invalid' as const, fields: res.fields } };
    });
  }

  /** Raw image bytes, judged by magic bytes like the bottle photos (ADR 0020); `?vialMl=5` for the 5 × 5 ml set. */
  @UseGuards(OwnerGuard)
  @Put('admin/sets/discovery/photo')
  async photo(@CurrentStaff() actor: StaffRow, @Req() req: Request, @Query() query: unknown) {
    const parsed = discoveryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const res = await this.sets.setPhoto(actor, parsed.data.vialMl, readPhotoBody(req.body));
    if (res.ok) return { photo: res.value };
    throw photoFailure(res.reason);
  }
}

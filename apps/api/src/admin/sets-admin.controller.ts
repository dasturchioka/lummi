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

/** Any active staff member reads the sets and counts the boxes; adding a set, its name, price, composition and photo are the owner's. */
@Controller()
@UseGuards(StaffGuard)
export class SetsAdminController {
  constructor(@Inject(SetsAdminService) private readonly sets: SetsAdminService) {}

  @TsRestHandler(adminContract.sets.list)
  list() {
    return tsRestHandler(adminContract.sets.list, async () => ({
      status: 200 as const,
      body: await this.sets.list(),
    }));
  }

  @TsRestHandler(adminContract.sets.get)
  get() {
    return tsRestHandler(adminContract.sets.get, async ({ query }) => {
      const set = await this.sets.get(query.key);
      return set
        ? { status: 200 as const, body: set }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @UseGuards(OwnerGuard)
  @TsRestHandler(adminContract.sets.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.sets.create, async ({ body }) => {
      const res = await this.sets.create(actor, body);
      return res.ok
        ? { status: 201 as const, body: res.value }
        : { status: 422 as const, body: { code: 'invalid' as const, fields: res.fields } };
    });
  }

  @TsRestHandler(adminContract.sets.setOnHand)
  setOnHand(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.sets.setOnHand, async ({ query, body }) => {
      const res = await this.sets.setOnHand(
        actor,
        query.key,
        body.onHand,
        body.expected,
        body.reason,
      );
      if (res.ok) return { status: 200 as const, body: res.value };
      return res.reason === 'not_found'
        ? { status: 404 as const, body: { code: 'not_found' as const } }
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
      const res = await this.sets.update(actor, query.key, body);
      if (res.ok) return { status: 200 as const, body: res.value };
      return res.reason === 'not_found'
        ? { status: 404 as const, body: { code: 'not_found' as const } }
        : {
            status: 422 as const,
            body: { code: 'invalid' as const, fields: 'fields' in res ? res.fields : undefined },
          };
    });
  }

  /** Raw image bytes, judged by magic bytes like the bottle photos (ADR 0020); `?key=` names the set. */
  @UseGuards(OwnerGuard)
  @Put('admin/sets/discovery/photo')
  async photo(@CurrentStaff() actor: StaffRow, @Req() req: Request, @Query() query: unknown) {
    const parsed = discoveryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const res = await this.sets.setPhoto(actor, parsed.data.key, readPhotoBody(req.body));
    if (res.ok) return { photo: res.value };
    throw photoFailure(res.reason);
  }
}

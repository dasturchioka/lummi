import { MAX_PHOTO_BYTES, adminContract, type BroadcastBody } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, HttpException, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request } from 'express';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { BroadcastService, type Failure } from './broadcast.service';

const invalid = (f: Failure) => ({
  status: 422 as const,
  body: { code: 'invalid' as const, fields: f.fields },
});

/**
 * Broadcasts are the owner's alone (ADR 0017), enforced here and not by hiding the menu entry.
 * Route order matters: `audience` and `fragrance` are declared before `:id`.
 */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class BroadcastController {
  constructor(@Inject(BroadcastService) private readonly broadcasts: BroadcastService) {}

  @TsRestHandler(adminContract.broadcasts.list)
  list() {
    return tsRestHandler(adminContract.broadcasts.list, async () => ({
      status: 200 as const,
      body: await this.broadcasts.list(),
    }));
  }

  @TsRestHandler(adminContract.broadcasts.audience)
  audience() {
    return tsRestHandler(adminContract.broadcasts.audience, async ({ query }) => ({
      status: 200 as const,
      body: await this.broadcasts.audienceCount(query.audience),
    }));
  }

  @TsRestHandler(adminContract.broadcasts.fragrance)
  fragrance() {
    return tsRestHandler(adminContract.broadcasts.fragrance, async ({ query }) => {
      const found = await this.broadcasts.fragranceBySlug(query.slug);
      return found
        ? { status: 200 as const, body: found }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(adminContract.broadcasts.get)
  get() {
    return tsRestHandler(adminContract.broadcasts.get, async ({ params }) => {
      const b = await this.broadcasts.get(params.id);
      return b
        ? { status: 200 as const, body: b }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(adminContract.broadcasts.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.broadcasts.create, async ({ body }) => {
      const prepared = await this.broadcasts.prepare(body as BroadcastBody);
      if (!prepared.ok) return invalid(prepared);
      return { status: 201 as const, body: await this.broadcasts.send(actor, prepared.value) };
    });
  }

  @TsRestHandler(adminContract.broadcasts.test)
  test(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.broadcasts.test, async ({ body }) => {
      const prepared = await this.broadcasts.prepare(body as BroadcastBody);
      if (!prepared.ok) return invalid(prepared);
      const res = await this.broadcasts.sendTest(actor, prepared.value);
      if (res.ok) return { status: 200 as const, body: { sent: res.sent } };
      return res.reason === 'test_unlinked'
        ? { status: 409 as const, body: { code: res.reason } }
        : { status: 502 as const, body: { code: res.reason } };
    });
  }

  /**
   * Raw image bytes (`image/jpeg`, `image/png` or `image/webp`), judged by magic bytes and
   * dimensions like the catalog photos; answers the FileStore key the composer then sends.
   * Outside the ts-rest contract because the contract has no raw bodies.
   */
  @Put('admin/broadcasts/image')
  async image(@Req() req: Request) {
    const body: unknown = req.body;
    const bytes = Buffer.isBuffer(body) ? body : null;
    if (!bytes || bytes.length === 0) {
      throw new HttpException({ code: 'invalid', fields: ['image'] }, 415);
    }
    if (bytes.length > MAX_PHOTO_BYTES) {
      throw new HttpException({ code: 'invalid', fields: ['image'] }, 413);
    }
    const res = await this.broadcasts.storeImage(bytes);
    if (!res.ok) throw new HttpException({ code: 'invalid', fields: ['image'] }, 415);
    return res.value;
  }
}

import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { PromoAdminService, type PromoFailure } from './promo-admin.service';

const notFound = { status: 404 as const, body: { code: 'not_found' as const } };
function failure(f: PromoFailure) {
  if (f.reason === 'not_found') return notFound;
  // the Promo gift names no volume the catalog has (ADR 0039)
  if (f.reason === 'invalid')
    return { status: 422 as const, body: { code: f.reason, fields: f.fields ?? [] } };
  return { status: 409 as const, body: { code: f.reason } };
}

/** Promo codes are the owner's (ADR 0017): a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class PromoAdminController {
  constructor(@Inject(PromoAdminService) private readonly promo: PromoAdminService) {}

  @TsRestHandler(adminContract.promoCodes.list)
  list() {
    return tsRestHandler(adminContract.promoCodes.list, async () => ({
      status: 200 as const,
      body: await this.promo.list(),
    }));
  }

  // before `get`: `/stats` must not be read as an id
  @TsRestHandler(adminContract.promoCodes.stats)
  stats() {
    return tsRestHandler(adminContract.promoCodes.stats, async () => ({
      status: 200 as const,
      body: await this.promo.stats(),
    }));
  }

  @TsRestHandler(adminContract.promoCodes.get)
  get() {
    return tsRestHandler(adminContract.promoCodes.get, async ({ params }) => {
      const found = await this.promo.get(params.id);
      return found ? { status: 200 as const, body: found } : notFound;
    });
  }

  @TsRestHandler(adminContract.promoCodes.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.promoCodes.create, async ({ body }) => {
      const res = await this.promo.create(actor, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.promoCodes.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.promoCodes.update, async ({ params, body }) => {
      const res = await this.promo.update(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.promoCodes.remove)
  remove(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.promoCodes.remove, async ({ params }) => {
      const res = await this.promo.remove(actor, params.id);
      return res.ok ? { status: 200 as const, body: { ok: true as const } } : failure(res);
    });
  }
}

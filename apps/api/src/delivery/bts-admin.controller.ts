import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { BtsAdminService } from './bts-admin.service';

const err = (status: 404 | 409 | 422, code: 'not_found' | 'conflict' | 'unknown_region') =>
  ({ status, body: { code } }) as const;

/** Staff (owner and manager) keep the point list; the owner alone sets tariffs (method-level OwnerGuard). */
@Controller()
@UseGuards(StaffGuard)
export class BtsAdminController {
  constructor(@Inject(BtsAdminService) private readonly admin: BtsAdminService) {}

  @TsRestHandler(adminContract.regions.list)
  listRegions() {
    return tsRestHandler(adminContract.regions.list, async () => ({
      status: 200 as const,
      body: await this.admin.listRegions(),
    }));
  }

  @UseGuards(OwnerGuard)
  @TsRestHandler(adminContract.regions.setTariff)
  setTariff(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.regions.setTariff, async ({ params, body }) => {
      const res = await this.admin.setTariff(actor, params.id, body.deliveryTariff);
      return res.ok ? { status: 200 as const, body: res.value } : err(404, 'not_found');
    });
  }

  @TsRestHandler(adminContract.btsPoints.list)
  listPoints() {
    return tsRestHandler(adminContract.btsPoints.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.admin.listPoints(query),
    }));
  }

  @TsRestHandler(adminContract.btsPoints.create)
  createPoint(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.btsPoints.create, async ({ body }) => {
      const res = await this.admin.createPoint(actor, body);
      if (res.ok) return { status: 201 as const, body: res.value };
      return res.reason === 'conflict' ? err(409, 'conflict') : err(422, 'unknown_region');
    });
  }

  @TsRestHandler(adminContract.btsPoints.update)
  updatePoint(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.btsPoints.update, async ({ params, body }) => {
      const res = await this.admin.updatePoint(actor, params.id, body);
      if (res.ok) return { status: 200 as const, body: res.value };
      return res.reason === 'not_found' ? err(404, 'not_found') : err(422, 'unknown_region');
    });
  }
}

import { contract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { StaffService } from '../staff/staff.service';
import { toStaffDto } from './staff.dto';

/** One mapping for service failures: unknown id is 404, a refused change is 409. */
const conflict = () => ({ status: 409 as const, body: { code: 'conflict' as const } });

function failure(reason: 'not_found' | 'conflict') {
  return reason === 'not_found'
    ? { status: 404 as const, body: { code: 'not_found' as const } }
    : { status: 409 as const, body: { code: 'conflict' as const } };
}

/** Everything here is owner-only; later owner-only endpoints use the same two guards. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @TsRestHandler(contract.admin.staff.list)
  list() {
    return tsRestHandler(contract.admin.staff.list, async () => ({
      status: 200 as const,
      body: (await this.staff.list()).map(toStaffDto),
    }));
  }

  @TsRestHandler(contract.admin.staff.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(contract.admin.staff.create, async ({ body }) => {
      const res = await this.staff.addManager(actor, body);
      return res.ok ? { status: 201 as const, body: toStaffDto(res.staff) } : conflict();
    });
  }

  @TsRestHandler(contract.admin.staff.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(contract.admin.staff.update, async ({ params, body }) => {
      const res = await this.staff.setActive(actor, params.id, body.active);
      if (res.ok) return { status: 200 as const, body: toStaffDto(res.staff) };
      return failure(res.reason);
    });
  }

  @TsRestHandler(contract.admin.staff.remove)
  remove(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(contract.admin.staff.remove, async ({ params }) => {
      const res = await this.staff.remove(actor, params.id);
      if (res.ok) return { status: 200 as const, body: { ok: true as const } };
      return failure(res.reason);
    });
  }
}

import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { StaffService, type PasswordRefusal, type StaffRefusal } from '../staff/staff.service';
import { toStaffDto } from './staff.dto';

/** One mapping for service failures: unknown id is 404, a refused change is 409. */
function failure(reason: StaffRefusal) {
  return reason === 'not_found'
    ? { status: 404 as const, body: { code: 'not_found' as const } }
    : reason === 'login_required'
      ? { status: 422 as const, body: { code: 'login_required' as const } }
      : { status: 409 as const, body: { code: reason } };
}

const passwordFailure = (res: PasswordRefusal) => ({
  status: 422 as const,
  body: { code: res.reason, minLength: res.minLength },
});

/** Everything here is owner-only; later owner-only endpoints use the same two guards. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @TsRestHandler(adminContract.staff.list)
  list() {
    return tsRestHandler(adminContract.staff.list, async () => ({
      status: 200 as const,
      body: (await this.staff.list()).map(toStaffDto),
    }));
  }

  @TsRestHandler(adminContract.staff.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.staff.create, async ({ body }) => {
      const res = await this.staff.addManager(actor, body);
      if (res.ok) return { status: 201 as const, body: toStaffDto(res.staff) };
      if ('minLength' in res) return passwordFailure(res);
      return { status: 409 as const, body: { code: 'login_taken' as const } };
    });
  }

  @TsRestHandler(adminContract.staff.resetPassword)
  resetPassword(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.staff.resetPassword, async ({ params, body }) => {
      const res = await this.staff.resetPassword(actor, params.id, body);
      if (res.ok) return { status: 200 as const, body: toStaffDto(res.staff) };
      return 'minLength' in res ? passwordFailure(res) : failure(res.reason);
    });
  }

  @TsRestHandler(adminContract.staff.unlinkTelegram)
  unlinkTelegram(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.staff.unlinkTelegram, async ({ params }) => {
      const res = await this.staff.unlinkTelegram(actor, params.id);
      if (res.ok) return { status: 200 as const, body: toStaffDto(res.staff) };
      return failure(res.reason);
    });
  }

  @TsRestHandler(adminContract.staff.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.staff.update, async ({ params, body }) => {
      const res = await this.staff.setActive(actor, params.id, body.active);
      if (res.ok) return { status: 200 as const, body: toStaffDto(res.staff) };
      return failure(res.reason);
    });
  }

  @TsRestHandler(adminContract.staff.remove)
  remove(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.staff.remove, async ({ params }) => {
      const res = await this.staff.remove(actor, params.id);
      if (res.ok) return { status: 200 as const, body: { ok: true as const } };
      return failure(res.reason);
    });
  }
}

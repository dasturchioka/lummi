import { adminContract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { BirthdayAdminService } from './birthday-admin.service';

/** The birthday coupons report is Marketing's, so the owner's (ADR 0017): a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class BirthdayAdminController {
  constructor(@Inject(BirthdayAdminService) private readonly coupons: BirthdayAdminService) {}

  @TsRestHandler(adminContract.birthdayCoupons.list)
  list() {
    return tsRestHandler(adminContract.birthdayCoupons.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.coupons.list(query),
    }));
  }
}

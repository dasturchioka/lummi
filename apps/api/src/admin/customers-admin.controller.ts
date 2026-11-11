import { adminContract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { StaffRow } from '@lummi/db';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { CustomersAdminService } from './customers-admin.service';

/**
 * Customers: owner and manager. The phone is visible to both (the ticket's AC); who else may see
 * it is the open "trust line" question and is not decided here.
 */
@Controller()
@UseGuards(StaffGuard)
export class CustomersAdminController {
  constructor(@Inject(CustomersAdminService) private readonly customers: CustomersAdminService) {}

  @TsRestHandler(adminContract.customers.list)
  list() {
    return tsRestHandler(adminContract.customers.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.customers.list(query),
    }));
  }

  @TsRestHandler(adminContract.customers.get)
  get() {
    return tsRestHandler(adminContract.customers.get, async ({ params }) => {
      const customer = await this.customers.get(params.id);
      return customer
        ? { status: 200 as const, body: customer }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  /** TZ §3.8: the customer enters the date of birth once; only the owner corrects it, audited (#30). */
  @TsRestHandler(adminContract.customers.setBirthDate)
  @UseGuards(OwnerGuard)
  setBirthDate(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.customers.setBirthDate, async ({ params, body }) => {
      const r = await this.customers.setBirthDate(actor.id, params.id, body.birthDate);
      if (r === 'not_found') return { status: 404 as const, body: { code: r } };
      if (r === 'invalid_birth_date' || r === 'phone_required')
        return { status: 422 as const, body: { code: r } };
      return { status: 200 as const, body: r };
    });
  }
}

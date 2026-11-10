import { adminContract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { StaffGuard } from '../staff/staff.guard';
import { CustomersAdminService } from './customers-admin.service';
import { StockAdminService } from './stock-admin.service';

/** The stock page's read side: owner and manager (ADR 0017). The writes are the on-hand routes. */
@Controller()
@UseGuards(StaffGuard)
export class StockAdminController {
  constructor(@Inject(StockAdminService) private readonly stock: StockAdminService) {}

  @TsRestHandler(adminContract.stock.list)
  list() {
    return tsRestHandler(adminContract.stock.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.stock.list(query),
    }));
  }
}

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
}

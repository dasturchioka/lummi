import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { StockAdminService } from './stock-admin.service';

/** The stock page's read side: owner and manager (ADR 0017). The writes are the on-hand routes. */
@Controller()
@UseGuards(StaffGuard)
export class StockAdminController {
  constructor(@Inject(StockAdminService) private readonly stock: StockAdminService) {}

  @TsRestHandler(adminContract.stock.list)
  list(@CurrentStaff() viewer: StaffRow) {
    return tsRestHandler(adminContract.stock.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.stock.list(query, viewer),
    }));
  }
}

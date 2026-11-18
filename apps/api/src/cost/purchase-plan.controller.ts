import { adminContract, purchasePlanExportQuerySchema, REPORT_EXPORT_MIME } from '@lummi/contracts';
import { Controller, Get, HttpException, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { PurchasePlans } from './purchase-plan.service';

/** The purchase planner is the owner's (ADR 0017): a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class PurchasePlanController {
  constructor(@Inject(PurchasePlans) private readonly plans: PurchasePlans) {}

  @TsRestHandler(adminContract.purchasePlan)
  plan() {
    return tsRestHandler(adminContract.purchasePlan, async ({ query }) => ({
      status: 200 as const,
      body: await this.plans.plan(query),
    }));
  }

  /** The same plan as an Excel file; a file, so it is outside the ts-rest contract. */
  @Get('admin/purchase-plan/export')
  async export(@Query() query: Record<string, string>, @Res() res: Response): Promise<void> {
    const parsed = purchasePlanExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException({ code: 'invalid' }, 422);
    const { lang, ...rest } = parsed.data;
    res
      .status(200)
      .type(REPORT_EXPORT_MIME)
      .setHeader('content-disposition', 'attachment; filename="LUMMI_Zakupka.xlsx"')
      .setHeader('cache-control', 'no-store')
      .send(await this.plans.workbook(rest, lang));
  }
}

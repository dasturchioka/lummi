import {
  adminContract,
  profitabilityExportQuerySchema,
  REPORT_EXPORT_MIME,
} from '@lummi/contracts';
import { Controller, Get, HttpException, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { Profitability } from './profitability.service';

/** «Рентабельность» (#77) is the owner's, as reports and the catalog's costs are: a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class ProfitabilityController {
  constructor(@Inject(Profitability) private readonly profitability: Profitability) {}

  @TsRestHandler(adminContract.profitability.table)
  table() {
    return tsRestHandler(adminContract.profitability.table, async ({ query }) => ({
      status: 200 as const,
      body: await this.profitability.table(query),
    }));
  }

  @TsRestHandler(adminContract.profitability.quote)
  quote() {
    return tsRestHandler(adminContract.profitability.quote, async ({ body }) => {
      const quote = await this.profitability.quote(body);
      return quote
        ? { status: 200 as const, body: quote }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  /** The table as an Excel file, with the page's channel and toggles; a file, so outside the contract. */
  @Get('admin/profitability/export')
  async export(@Query() query: Record<string, string>, @Res() res: Response): Promise<void> {
    const parsed = profitabilityExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException({ code: 'invalid' }, 422);
    const { lang, ...view } = parsed.data;
    res
      .status(200)
      .type(REPORT_EXPORT_MIME)
      .setHeader('content-disposition', 'attachment; filename="LUMMI_Rentabelnost.xlsx"')
      .setHeader('cache-control', 'no-store')
      .send(await this.profitability.workbook(view, lang));
  }
}

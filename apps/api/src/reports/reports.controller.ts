import {
  adminContract,
  SALES_REPORT_EXPORT_MIME,
  salesReportExportQuerySchema,
} from '@lummi/contracts';
import { Controller, Get, HttpException, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { SalesReports } from './sales-reports.service';

const invalidRange = { status: 422 as const, body: { code: 'invalid_range' as const } };

/** Reports are the owner's (TZ §7, ADR 0017): a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class ReportsController {
  constructor(@Inject(SalesReports) private readonly sales: SalesReports) {}

  @TsRestHandler(adminContract.reports.sales)
  salesReport() {
    return tsRestHandler(adminContract.reports.sales, async ({ query }) => {
      const report = await this.sales.report(query);
      return report === 'invalid_range' ? invalidRange : { status: 200 as const, body: report };
    });
  }

  /** The same report as an Excel file; a file, so it is outside the ts-rest contract. */
  @Get('admin/reports/sales/export')
  async salesExport(@Query() query: Record<string, string>, @Res() res: Response): Promise<void> {
    const parsed = salesReportExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException({ code: 'invalid' }, 422);
    const { lang, ...range } = parsed.data;
    const bytes = await this.sales.workbook(range, lang);
    if (bytes === 'invalid_range') throw new HttpException(invalidRange.body, 422);
    res
      .status(200)
      .type(SALES_REPORT_EXPORT_MIME)
      .setHeader('content-disposition', 'attachment; filename="LUMMI_Prodazhi.xlsx"')
      .setHeader('cache-control', 'no-store')
      .send(bytes);
  }
}

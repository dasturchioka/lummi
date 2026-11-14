import {
  adminContract,
  marketingReportExportQuerySchema,
  REPORT_EXPORT_MIME,
  reportExportQuerySchema,
} from '@lummi/contracts';
import { Controller, Get, HttpException, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { MarketingReports } from './marketing-reports.service';
import { SalesReports } from './sales-reports.service';

const invalidRange = { status: 422 as const, body: { code: 'invalid_range' as const } };

/** Reports are the owner's (TZ §7, ADR 0017): a manager gets 403. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class ReportsController {
  constructor(
    @Inject(SalesReports) private readonly sales: SalesReports,
    @Inject(MarketingReports) private readonly marketing: MarketingReports,
  ) {}

  @TsRestHandler(adminContract.reports.sales)
  salesReport() {
    return tsRestHandler(adminContract.reports.sales, async ({ query }) => {
      const report = await this.sales.report(query);
      return report === 'invalid_range' ? invalidRange : { status: 200 as const, body: report };
    });
  }

  @TsRestHandler(adminContract.reports.marketing)
  marketingReport() {
    return tsRestHandler(adminContract.reports.marketing, async ({ query }) => {
      const report = await this.marketing.report(query);
      return report === 'invalid_range' ? invalidRange : { status: 200 as const, body: report };
    });
  }

  /** The same report as an Excel file; a file, so it is outside the ts-rest contract. */
  @Get('admin/reports/sales/export')
  async salesExport(@Query() query: Record<string, string>, @Res() res: Response): Promise<void> {
    const parsed = reportExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException({ code: 'invalid' }, 422);
    const { lang, ...rest } = parsed.data;
    send(res, 'LUMMI_Prodazhi.xlsx', await this.sales.workbook(rest, lang));
  }

  /** The marketing report as an Excel file, with the same range and filters as the page. */
  @Get('admin/reports/marketing/export')
  async marketingExport(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = marketingReportExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException({ code: 'invalid' }, 422);
    const { lang, ...rest } = parsed.data;
    send(res, 'LUMMI_Marketing.xlsx', await this.marketing.workbook(rest, lang));
  }
}

/** A report's Excel file, or 422 for a range that is no report range. */
function send(res: Response, filename: string, bytes: Buffer | 'invalid_range'): void {
  if (bytes === 'invalid_range') throw new HttpException(invalidRange.body, 422);
  res
    .status(200)
    .type(REPORT_EXPORT_MIME)
    .setHeader('content-disposition', `attachment; filename="${filename}"`)
    .setHeader('cache-control', 'no-store')
    .send(bytes);
}

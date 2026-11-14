import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  SALES_REPORT_DEFAULT_DAYS,
  SALES_REPORT_MAX_DAYS,
  tashkentDay,
  type SalesReport,
  type SalesReportQuery,
} from '@lummi/contracts';
import type { Db } from '@lummi/db';
import type { Language } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { salesSummary, type TashkentRange } from './sales-summary';
import { salesWorkbook } from './sales-workbook';

/**
 * The owner's sales report (#42): the range the admin asked for (the last 30 Tashkent days
 * without one), `salesSummary` over it, and the same figures as an Excel file.
 */
@Injectable()
export class SalesReports {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  async report(query: SalesReportQuery): Promise<SalesReport | 'invalid_range'> {
    const range = this.rangeOf(query);
    return range ? salesSummary(this.db, range) : 'invalid_range';
  }

  async workbook(query: SalesReportQuery, language: Language): Promise<Buffer | 'invalid_range'> {
    const report = await this.report(query);
    return report === 'invalid_range' ? report : salesWorkbook(report, language);
  }

  /**
   * The asked range, a missing end filled in: no `to` is today (Tashkent), no `from` is 30 days
   * up to `to`. Null when `from` is after `to` or the range passes `SALES_REPORT_MAX_DAYS`.
   */
  private rangeOf(query: SalesReportQuery): TashkentRange | null {
    const to = query.to ?? formatLocalDate(tashkentDay(this.edges.clock.now()));
    const from =
      query.from ?? formatLocalDate(addDays(parseLocalDate(to), 1 - SALES_REPORT_DEFAULT_DAYS));
    if (from > to) return null;
    const last = formatLocalDate(addDays(parseLocalDate(from), SALES_REPORT_MAX_DAYS - 1));
    return to > last ? null : { from, to };
  }
}

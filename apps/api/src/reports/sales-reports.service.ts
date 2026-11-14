import type { SalesReport, SalesReportQuery } from '@lummi/contracts';
import type { Db } from '@lummi/db';
import type { Language } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { askedRange, salesSummary } from './sales-summary';
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
    const range = askedRange(query, this.edges.clock.now());
    return range ? salesSummary(this.db, range) : 'invalid_range';
  }

  async workbook(query: SalesReportQuery, language: Language): Promise<Buffer | 'invalid_range'> {
    const report = await this.report(query);
    return report === 'invalid_range' ? report : salesWorkbook(report, language);
  }
}

import type { MarketingReport, SalesReportQuery } from '@lummi/contracts';
import type { Db } from '@lummi/db';
import type { Language } from '@lummi/i18n';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { DB, EDGES } from '../tokens';
import { marketingSummary } from './marketing-summary';
import { marketingWorkbook } from './marketing-workbook';
import { askedRange } from './sales-summary';

/**
 * The owner's marketing reports (#43): promo codes, Sources, first links and the set discount over
 * the range the admin asked for (the sales report's range rules), and the same as an Excel file.
 */
@Injectable()
export class MarketingReports {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  async report(query: SalesReportQuery): Promise<MarketingReport | 'invalid_range'> {
    const range = askedRange(query, this.edges.clock.now());
    return range ? marketingSummary(this.db, range) : 'invalid_range';
  }

  async workbook(query: SalesReportQuery, language: Language): Promise<Buffer | 'invalid_range'> {
    const report = await this.report(query);
    return report === 'invalid_range' ? report : marketingWorkbook(report, language);
  }
}

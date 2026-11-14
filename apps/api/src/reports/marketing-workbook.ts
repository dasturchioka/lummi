import {
  NO_PROMO_CODE,
  NO_SOURCE,
  type MarketingFigures,
  type MarketingReport,
  type ReportLink,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import ExcelJS from 'exceljs';
import { MONEY, sheet, type Column } from './report-workbook';

const PERCENT = '0.0%';

/**
 * The marketing reports as an Excel file (#43), in the admin's language: promo codes, Sources
 * (each Source's row, then its links), acquisition, the set discount, narrowed by the same
 * filters as the page (named in the file's title). It only lays out what `marketingSummary`
 * computed. Money cells are numbers in whole so'm; the conversion is a percentage cell; a figure
 * the page hides (no link) is an empty cell.
 */
export async function marketingWorkbook(
  report: MarketingReport,
  language: Language,
): Promise<Buffer> {
  const { admin } = adminMessages[language];
  const r = admin.reports;
  const m = r.marketing;
  const f = m.figures;
  const sourceName = admin.campaigns.sources;
  const linkName = (l: ReportLink) => (l.sourceLabel ? `${l.sourceLabel} (${l.code})` : l.code);
  const { source, code } = report.filters;
  const filtered = [
    source &&
      `${m.filters.source}: ${source === NO_SOURCE ? m.filters.noSource : sourceName[source]}`,
    code && `${m.filters.code}: ${code === NO_PROMO_CODE ? m.filters.noCode : code}`,
  ].filter(Boolean);
  const wb = new ExcelJS.Workbook();
  wb.title = [`${m.title}: ${report.from} — ${report.to}`, ...filtered].join('; ');

  const figureColumns: Column[] = [
    { header: f.orders, key: 'orders', width: 10 },
    { header: f.customers, key: 'customers', width: 12 },
    { header: f.firstTimeBuyers, key: 'firstTimeBuyers', width: 12 },
    { header: f.itemsBeforeDiscount, key: 'itemsBeforeDiscount', width: 18, numFmt: MONEY },
    { header: f.discount, key: 'discount', width: 14, numFmt: MONEY },
    { header: f.refunds, key: 'refunds', width: 16, numFmt: MONEY },
    { header: f.net, key: 'net', width: 18, numFmt: MONEY },
    { header: f.averageCheck, key: 'averageCheck', width: 16, numFmt: MONEY },
  ];
  const figures = (x: MarketingFigures) => ({ ...x, averageCheck: x.averageCheck ?? '' });
  const share = (p: number | null) => (p === null ? '' : p / 100);

  const promo = sheet(wb, m.excel.promo, [
    { header: m.promo.code, key: 'code', width: 18 },
    { header: m.promo.links, key: 'links', width: 36 },
    { header: f.opens, key: 'opens', width: 12 },
    ...figureColumns,
    { header: f.linkOrders, key: 'linkOrders', width: 14 },
    { header: f.conversion, key: 'conversion', width: 12, numFmt: PERCENT },
  ]);
  for (const p of report.promoCodes)
    promo.addRow({
      ...figures(p),
      code: p.code,
      links: p.links.map((l) => `${sourceName[l.source]}: ${linkName(l)}`).join('; '),
      opens: p.opens ?? '',
      conversion: share(p.conversion),
    });

  const sources = sheet(wb, m.excel.sources, [
    { header: m.sources.source, key: 'source', width: 20 },
    { header: m.sources.link, key: 'link', width: 30 },
    { header: f.opens, key: 'opens', width: 12 },
    ...figureColumns,
    { header: f.conversion, key: 'conversion', width: 12, numFmt: PERCENT },
  ]);
  for (const s of report.sources) {
    sources.addRow({
      ...figures(s),
      source: sourceName[s.source],
      link: m.sources.allLinks,
      conversion: share(s.conversion),
    }).font = { bold: true };
    for (const l of s.links)
      sources.addRow({
        ...figures(l),
        source: sourceName[s.source],
        link: linkName(l.link),
        conversion: share(l.conversion),
      });
  }
  // orders without a link are a row of their own unless the Source filter names a Source
  if (!source || source === NO_SOURCE)
    sources.addRow({
      ...figures(report.withoutLink),
      source: m.sources.withoutLink,
      link: '',
      opens: '',
      conversion: '',
    });

  const acquisition = sheet(wb, m.excel.acquisition, [
    { header: m.sources.source, key: 'source', width: 20 },
    { header: m.sources.link, key: 'link', width: 30 },
    { header: f.acquired, key: 'acquired', width: 14 },
    ...figureColumns,
  ]);
  for (const a of report.acquisition) {
    acquisition.addRow({
      ...figures(a),
      source: sourceName[a.source],
      link: m.sources.allLinks,
    }).font = { bold: true };
    for (const l of a.links)
      acquisition.addRow({ ...figures(l), source: sourceName[a.source], link: linkName(l.link) });
  }
  for (const [name, row] of [
    [m.acquisition.earlierCustomers, report.earlierCustomers],
    [m.acquisition.withoutFirstLink, report.withoutFirstLink],
  ] as const)
    acquisition.addRow({ ...figures(row), source: name, link: '', acquired: '' });

  const rights = sheet(wb, m.excel.rights, [
    { header: m.rights.kind, key: 'kind', width: 20 },
    { header: f.issued, key: 'issued', width: 10 },
    { ...figureColumns[0]!, header: f.used },
    ...figureColumns.slice(1),
  ]);
  for (const row of report.upgradeRights)
    rights.addRow({ ...figures(row), kind: m.rights.sources[row.source] });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

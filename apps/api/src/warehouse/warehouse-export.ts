import { STOCK_VOLUMES_ML } from '@lummi/contracts/constants';
import { asc, fragrances, sql, volumes, type Db, type StaffRow } from '@lummi/db';
import { fill, type Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { MONEY, sheet, tashkentWallClock, type Column } from '../reports/report-workbook';
import { isOwner } from '../staff/staff.guard';
import { DB } from '../tokens';
import { fragranceOils, readOilContext } from './fragrance-oil';
import { stockHistory } from './warehouse.service';

const WHEN = 'dd.mm.yyyy hh:mm';
const GRAMS = '#,##0.###';

/** `GET /admin/warehouse/export` (#76): the warehouse as a workbook, in the staff member's language. */
@Injectable()
export class WarehouseExport {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Sheet one: every fragrance's oil balance, litres and bottles on hand, with the stock at cost
   * for the owner. Sheet two: the whole history, newest first. One snapshot for both; the audit
   * entry is written in it.
   */
  async workbook(actor: StaffRow, language: Language): Promise<Buffer> {
    const withValue = isOwner(actor);
    return this.db.transaction(
      async (tx) => {
        const ctx = await readOilContext(tx, withValue);
        const rows = await tx
          .select({ id: fragrances.id, name: fragrances.name })
          .from(fragrances)
          .orderBy(asc(sql`lower(${fragrances.name})`), asc(fragrances.id));
        const oil = await fragranceOils(
          tx,
          rows.map((r) => r.id),
          ctx,
        );
        const counts = await tx
          .select({ fragranceId: volumes.fragranceId, ml: volumes.ml, onHand: volumes.onHand })
          .from(volumes);
        const history = await stockHistory(tx, null, withValue);
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'warehouse.exported',
          targetType: 'warehouse',
          payload: { fragrances: rows.length, moves: history.length },
        });

        const x = adminMessages[language].admin.warehouse;
        const e = x.export;
        const wb = new ExcelJS.Workbook();
        wb.title = e.sheet;
        const mlColumns: Column[] = STOCK_VOLUMES_ML.map((ml) => ({
          header: fill(e.bottles, { ml: String(ml) }),
          key: `ml${ml}`,
          width: 12,
        }));
        const ws = sheet(wb, e.sheet, [
          { header: e.fragrance, key: 'name', width: 32 },
          { header: e.oil, key: 'oil', width: 12, numFmt: GRAMS },
          { header: e.liquid, key: 'liquid', width: 12, numFmt: '0.000' },
          ...mlColumns,
          ...(withValue
            ? [
                { header: e.oilValue, key: 'oilValue', width: 20, numFmt: MONEY },
                { header: e.bottlesValue, key: 'bottlesValue', width: 22, numFmt: MONEY },
                { header: e.total, key: 'total', width: 16, numFmt: MONEY },
              ]
            : []),
        ]);
        for (const r of rows) {
          const o = oil.get(r.id)!;
          const mine = counts.filter((c) => c.fragranceId === r.id);
          ws.addRow({
            name: r.name,
            oil: o.oilGrams,
            liquid: o.liquidLitres,
            ...Object.fromEntries(
              STOCK_VOLUMES_ML.map((ml) => [
                `ml${ml}`,
                mine.find((c) => c.ml === ml)?.onHand ?? null,
              ]),
            ),
            ...(o.value
              ? { oilValue: o.value.oil, bottlesValue: o.value.bottles, total: o.value.total }
              : {}),
          });
        }

        const names = new Map(rows.map((r) => [r.id, r.name]));
        const hs = sheet(wb, e.historySheet, [
          { header: e.at, key: 'at', width: 17, numFmt: WHEN },
          { header: e.fragrance, key: 'name', width: 32 },
          { header: e.kind, key: 'kind', width: 22 },
          { header: e.oil, key: 'oil', width: 12, numFmt: GRAMS },
          ...mlColumns,
          { header: e.document, key: 'document', width: 28 },
          { header: e.reason, key: 'reason', width: 32 },
          { header: e.who, key: 'who', width: 22 },
        ]);
        for (const m of history) {
          hs.addRow({
            at: tashkentWallClock(new Date(m.at)),
            name: names.get(m.fragranceId) ?? '',
            kind: x.kinds[m.kind],
            oil: m.oilGrams || null,
            ...Object.fromEntries(
              STOCK_VOLUMES_ML.map((ml) => [
                `ml${ml}`,
                m.bottles.find((b) => b.ml === ml)?.change ?? null,
              ]),
            ),
            document:
              m.orderNumber !== null
                ? fill(x.order, { number: String(m.orderNumber) })
                : m.invoice !== null
                  ? [m.supplier, m.invoice].filter(Boolean).join(', ')
                  : m.source
                    ? x.sources[m.source]
                    : '',
            reason: m.reason ?? '',
            who: m.actorName ?? '',
          });
        }
        return Buffer.from(await wb.xlsx.writeBuffer());
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}

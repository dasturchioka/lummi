import { STOCK_VOLUMES_ML } from '@lummi/contracts/constants';
import { asc, consumables, fragrances, sql, type Db, type StaffRow } from '@lummi/db';
import { fill, type Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { MONEY, sheet, tashkentWallClock, type Column } from '../reports/report-workbook';
import { isOwner } from '../staff/staff.guard';
import { DB } from '../tokens';
import { fragranceStocks, readStockContext } from './fragrance-stock';
import { stockHistory } from './warehouse.service';

const WHEN = 'dd.mm.yyyy hh:mm';
const GRAMS = '#,##0.###';
const ML = '#,##0.###';

/** `GET /admin/warehouse/export` (#76, #82): the warehouse as a workbook, in the staff member's language. */
@Injectable()
export class WarehouseExport {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Sheet one: every fragrance's oil (g and ml) and ready concentrate (counted, held by orders,
   * free), with the stock at cost for the owner (ADR 0043). Sheet two: the consumables. Sheet
   * three: the whole history, newest first. One snapshot for all; the audit entry is written in it.
   */
  async workbook(actor: StaffRow, language: Language): Promise<Buffer> {
    const withValue = isOwner(actor);
    return this.db.transaction(
      async (tx) => {
        const ctx = await readStockContext(tx, withValue);
        const rows = await tx
          .select({ id: fragrances.id, name: fragrances.name })
          .from(fragrances)
          .orderBy(asc(sql`lower(${fragrances.name})`), asc(fragrances.id));
        const stock = await fragranceStocks(
          tx,
          rows.map((r) => r.id),
          ctx,
        );
        const items = await tx.select().from(consumables).orderBy(asc(consumables.id));
        const history = await stockHistory(tx, null, withValue);
        await this.audit.record(tx, {
          actor: { type: 'staff', id: actor.id },
          action: 'warehouse.exported',
          targetType: 'warehouse',
          payload: { fragrances: rows.length, consumables: items.length, moves: history.length },
        });

        const x = adminMessages[language].admin.warehouse;
        const e = x.export;
        const nameOf = (c: { nameRu: string; nameUz: string }) =>
          language === 'uz' ? c.nameUz : c.nameRu;
        const wb = new ExcelJS.Workbook();
        wb.title = e.sheet;
        const ws = sheet(wb, e.sheet, [
          { header: e.fragrance, key: 'name', width: 32 },
          { header: e.oil, key: 'oil', width: 12, numFmt: GRAMS },
          { header: e.oilMl, key: 'oilMl', width: 12, numFmt: ML },
          { header: e.concentrate, key: 'concentrate', width: 16, numFmt: ML },
          { header: e.reserved, key: 'reserved', width: 14, numFmt: ML },
          { header: e.available, key: 'available', width: 14, numFmt: ML },
          ...(withValue
            ? [
                { header: e.oilValue, key: 'oilValue', width: 20, numFmt: MONEY },
                { header: e.concentrateValue, key: 'concentrateValue', width: 24, numFmt: MONEY },
                { header: e.total, key: 'total', width: 16, numFmt: MONEY },
              ]
            : []),
        ]);
        for (const r of rows) {
          const s = stock.get(r.id)!;
          ws.addRow({
            name: r.name,
            oil: s.oilGrams,
            oilMl: s.oilMl,
            concentrate: s.concentrateMl,
            reserved: s.reservedMl,
            available: s.availableMl,
            ...(s.value
              ? {
                  oilValue: s.value.oil,
                  concentrateValue: s.value.concentrate,
                  total: s.value.total,
                }
              : {}),
          });
        }

        const cs = sheet(wb, e.consumablesSheet, [
          { header: e.consumable, key: 'name', width: 28 },
          { header: e.unit, key: 'unit', width: 8 },
          { header: e.onHand, key: 'onHand', width: 14, numFmt: '#,##0' },
          { header: e.lowThreshold, key: 'low', width: 14, numFmt: '#,##0' },
          { header: e.state, key: 'state', width: 22 },
        ]);
        for (const c of items)
          cs.addRow({
            name: nameOf(c),
            unit: e.units[c.unit],
            onHand: c.onHand,
            low: c.lowThreshold,
            state: [c.archived ? e.archived : '', c.needsRecount ? e.recount : '']
              .filter(Boolean)
              .join(', '),
          });

        const mlColumns: Column[] = STOCK_VOLUMES_ML.map((ml) => ({
          header: fill(e.bottles, { ml: String(ml) }),
          key: `ml${ml}`,
          width: 11,
        }));
        const hs = sheet(wb, e.historySheet, [
          { header: e.at, key: 'at', width: 17, numFmt: WHEN },
          { header: e.subject, key: 'name', width: 32 },
          { header: e.kind, key: 'kind', width: 24 },
          { header: e.oil, key: 'oil', width: 12, numFmt: GRAMS },
          { header: e.concentrate, key: 'concentrate', width: 16, numFmt: ML },
          ...mlColumns,
          { header: e.consumables, key: 'consumables', width: 32 },
          { header: e.document, key: 'document', width: 28 },
          { header: e.reason, key: 'reason', width: 32 },
          { header: e.who, key: 'who', width: 22 },
        ]);
        for (const m of history) {
          hs.addRow({
            at: tashkentWallClock(new Date(m.at)),
            name: m.fragranceName ?? m.consumables.map(nameOf).join(', '),
            kind: x.kinds[m.kind],
            oil: m.oilGrams || null,
            concentrate: m.concentrateMl || null,
            ...Object.fromEntries(
              STOCK_VOLUMES_ML.map((ml) => [
                `ml${ml}`,
                m.bottles.find((b) => b.ml === ml)?.change ?? null,
              ]),
            ),
            consumables: m.consumables
              .map((c) => `${nameOf(c)} ${c.change > 0 ? '+' : ''}${c.change}`)
              .join(', '),
            document:
              m.orderNumber !== null
                ? fill(x.order, { number: String(m.orderNumber) })
                : m.uzumOrder !== null
                  ? fill(x.uzumOrder, { number: m.uzumOrder })
                  : m.invoice !== null
                    ? [m.supplier, m.invoice].filter(Boolean).join(', ')
                    : m.source
                      ? x.sources[m.source]
                      : (m.note ?? ''),
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

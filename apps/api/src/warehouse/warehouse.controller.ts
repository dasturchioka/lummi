import { adminContract, REPORT_EXPORT_MIME, warehouseExportQuerySchema } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Get, HttpException, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { gramsFromMg, mlFromUl } from './oil';
import { WarehouseExport } from './warehouse-export';
import { WarehouseService, type WarehouseFailure } from './warehouse.service';

/** Every warehouse failure as HTTP, in one place. */
function failure(f: WarehouseFailure) {
  switch (f.reason) {
    case 'not_found':
      return { status: 404 as const, body: { code: 'not_found' as const } };
    case 'invalid':
      return { status: 422 as const, body: { code: 'invalid' as const, fields: f.fields } };
    case 'voided':
    case 'draft':
    case 'not_draft':
      return { status: 409 as const, body: { code: f.reason } };
    case 'try_again':
      return { status: 409 as const, body: { code: 'try_again' as const } };
    case 'oil_short':
      return {
        status: 409 as const,
        body: {
          code: 'oil_short' as const,
          neededGrams: gramsFromMg(f.neededMg),
          balanceGrams: gramsFromMg(f.balanceMg),
          shortGrams: gramsFromMg(f.neededMg - f.balanceMg),
        },
      };
    case 'ethanol_short':
      return {
        status: 409 as const,
        body: {
          code: 'ethanol_short' as const,
          neededMl: f.neededMl,
          balanceMl: f.balanceMl,
          shortMl: f.neededMl - f.balanceMl,
        },
      };
    case 'concentrate_short':
      return {
        status: 409 as const,
        body: {
          code: 'concentrate_short' as const,
          fragrance: f.fragrance,
          neededMl: mlFromUl(f.neededUl),
          balanceMl: mlFromUl(f.balanceUl),
          shortMl: mlFromUl(f.neededUl - f.balanceUl),
        },
      };
    case 'changed':
      return {
        status: 409 as const,
        body: { code: 'changed' as const, currentMl: mlFromUl(f.currentUl) },
      };
  }
}

/**
 * The warehouse (#76, ADR 0041, 0043). Stock is the manager's work too (ADR 0017): the page, mixing,
 * concentrate counts, set assembly and the export. Oil receipts carry the shop's purchase prices
 * and are the owner's.
 */
@Controller()
@UseGuards(StaffGuard)
export class WarehouseController {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
    @Inject(WarehouseExport) private readonly exporter: WarehouseExport,
  ) {}

  @TsRestHandler(adminContract.warehouse.get)
  get(@CurrentStaff() viewer: StaffRow) {
    return tsRestHandler(adminContract.warehouse.get, async ({ params }) => {
      const page = await this.warehouse.get(params.id, viewer);
      return page
        ? { status: 200 as const, body: page }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(adminContract.warehouse.receiveOil)
  @UseGuards(OwnerGuard)
  receiveOil(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.receiveOil, async ({ params, body }) => {
      const res = await this.warehouse.receiveOil(actor, params.id, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.correctOilReceipt)
  @UseGuards(OwnerGuard)
  correctOilReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.correctOilReceipt, async ({ params, body }) => {
      const res = await this.warehouse.correctOilReceipt(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.voidOilReceipt)
  @UseGuards(OwnerGuard)
  voidOilReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.voidOilReceipt, async ({ params, body }) => {
      const res = await this.warehouse.voidOilReceipt(actor, params.id, body.reason);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.draftOilReceipts)
  @UseGuards(OwnerGuard)
  draftOilReceipts(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.draftOilReceipts, async ({ body }) => {
      const res = await this.warehouse.draftOilReceipts(actor, body);
      if (res.ok) return { status: 201 as const, body: res.value };
      return res.reason === 'invalid'
        ? { status: 422 as const, body: { code: 'invalid' as const, fields: res.fields } }
        : { status: 422 as const, body: { code: 'invalid' as const } };
    });
  }

  @TsRestHandler(adminContract.warehouse.confirmOilReceipt)
  @UseGuards(OwnerGuard)
  confirmOilReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.confirmOilReceipt, async ({ params, body }) => {
      const res = await this.warehouse.confirmOilReceipt(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.discardOilReceipt)
  @UseGuards(OwnerGuard)
  discardOilReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.discardOilReceipt, async ({ params }) => {
      const res = await this.warehouse.discardOilReceipt(actor, params.id);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.mix)
  mix(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.mix, async ({ params, body }) => {
      const res = await this.warehouse.mix(actor, params.id, body.ml);
      if (res.ok) return { status: 201 as const, body: res.value };
      const f = failure(res);
      return f.status === 422 ? { status: 404 as const, body: { code: 'not_found' as const } } : f;
    });
  }

  @TsRestHandler(adminContract.warehouse.countConcentrate)
  countConcentrate(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.countConcentrate, async ({ params, body }) => {
      const res = await this.warehouse.countConcentrate(actor, params.id, body);
      if (res.ok) return { status: 200 as const, body: res.value };
      const f = failure(res);
      return f.status === 422 ? { status: 404 as const, body: { code: 'not_found' as const } } : f;
    });
  }

  @TsRestHandler(adminContract.warehouse.assembleSet)
  assembleSet(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.assembleSet, async ({ params, body }) => {
      const res = await this.warehouse.assembleSet(actor, params.key, body.quantity);
      if (res.ok) return { status: 201 as const, body: res.value };
      const f = failure(res);
      // an unknown key reads as a set that cannot be assembled
      return f.status === 404 ? { status: 422 as const, body: { code: 'invalid' as const } } : f;
    });
  }

  /** The workbook: every fragrance's stock (values for the owner), the consumables, the whole history. */
  @Get('admin/warehouse/export')
  async export(
    @CurrentStaff() actor: StaffRow,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const parsed = warehouseExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new HttpException({ code: 'invalid' }, 400);
    const bytes = await this.exporter.workbook(actor, parsed.data.lang);
    res
      .status(200)
      .type(REPORT_EXPORT_MIME)
      .setHeader('content-disposition', 'attachment; filename="LUMMI_Ombor.xlsx"')
      .setHeader('cache-control', 'no-store')
      .send(bytes);
  }
}

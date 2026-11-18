import { adminContract, REPORT_EXPORT_MIME, warehouseExportQuerySchema } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Get, HttpException, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { gramsFromMg } from './oil';
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
      return { status: 409 as const, body: { code: 'voided' as const } };
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
  }
}

/**
 * The raw-material warehouse (#76, ADR 0041). Stock is the manager's work too (ADR 0017): the page,
 * bottling and the export. Receipts carry the shop's purchase prices and are the owner's.
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

  @TsRestHandler(adminContract.warehouse.receive)
  @UseGuards(OwnerGuard)
  receive(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.receive, async ({ params, body }) => {
      const res = await this.warehouse.receive(actor, params.id, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.correctReceipt)
  @UseGuards(OwnerGuard)
  correctReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.correctReceipt, async ({ params, body }) => {
      const res = await this.warehouse.correctReceipt(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.voidReceipt)
  @UseGuards(OwnerGuard)
  voidReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.voidReceipt, async ({ params, body }) => {
      const res = await this.warehouse.voidReceipt(actor, params.id, body.reason);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.warehouse.bottle)
  bottle(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.warehouse.bottle, async ({ params, body }) => {
      const res = await this.warehouse.bottle(actor, params.id, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  /** The workbook: every fragrance's oil and bottles (values for the owner), and the whole history. */
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

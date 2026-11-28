import { adminContract, CATALOG_IMPORT_MIME } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import {
  Controller,
  Get,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Request, Response } from 'express';
import type { ImportLimits } from '../catalog-import/catalog-import.service';
import { SettingsService } from '../settings/settings.service';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { UzumImportService } from './uzum-import.service';
import { UzumSalesService, type UzumFailure } from './uzum-sales.service';

/** Every Uzum sale failure as HTTP, in one place. */
function failure(f: UzumFailure) {
  switch (f.reason) {
    case 'not_found':
      return { status: 404 as const, body: { code: 'not_found' as const } };
    case 'invalid':
      return { status: 422 as const, body: { code: 'invalid' as const, fields: f.fields } };
    case 'stock_short':
      return { status: 409 as const, body: { code: 'stock_short' as const, short: f.short } };
    case 'duplicate_order':
    case 'voided':
    case 'try_again':
      return { status: 409 as const, body: { code: f.reason } };
  }
}

/**
 * Uzum sales (#80): stock work, so the owner's and the managers' (ADR 0017); the costs inside are
 * the owner's (the service leaves them out for a manager). The Excel import is the same work from
 * a file: raw xlsx bodies, the catalog import's upload limits (settings).
 */
@Controller()
@UseGuards(StaffGuard)
export class UzumController {
  constructor(
    @Inject(UzumSalesService) private readonly sales: UzumSalesService,
    @Inject(UzumImportService) private readonly imports: UzumImportService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @TsRestHandler(adminContract.uzum.list)
  list(@CurrentStaff() viewer: StaffRow) {
    return tsRestHandler(adminContract.uzum.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.sales.list(viewer, query.page),
    }));
  }

  @TsRestHandler(adminContract.uzum.record)
  record(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.uzum.record, async ({ body }) => {
      const res = await this.sales.record(actor, body);
      return res.ok ? { status: 201 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.uzum.void)
  void(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.uzum.void, async ({ params, body }) => {
      const res = await this.sales.void(actor, params.id, body.reason);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  private async limits(): Promise<ImportLimits> {
    const [maxBytes, maxRows] = await Promise.all([
      this.settings.get('catalog.import.maxBytes'),
      this.settings.get('catalog.import.maxRows'),
    ]);
    return { maxBytes, maxRows };
  }

  /** The upload is the raw xlsx bytes; anything else is a 415, a body over the cap a 413. */
  private upload(req: Request): Buffer {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpException({ code: 'invalid', fields: ['file'] }, 415);
    }
    return body;
  }

  @Get('admin/uzum/import/template')
  async template(@Res() res: Response) {
    res
      .status(200)
      .type(CATALOG_IMPORT_MIME)
      .setHeader('content-disposition', 'attachment; filename="LUMMI_Uzum_shablon.xlsx"')
      .setHeader('cache-control', 'no-store')
      .send(await this.imports.template());
  }

  @Post('admin/uzum/import/dry-run')
  async dryRun(@Req() req: Request) {
    return this.imports.dryRun(this.upload(req), await this.limits());
  }

  @Post('admin/uzum/import/apply')
  async apply(
    @Req() req: Request,
    @CurrentStaff() actor: StaffRow,
    @Query('token') token?: string,
  ) {
    const bytes = this.upload(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      throw new HttpException({ code: 'invalid', fields: ['token'] }, 422);
    }
    const res = await this.imports.apply(actor, bytes, token, await this.limits());
    if (res.ok) return res.applied;
    if (res.reason === 'invalid')
      throw new HttpException({ code: 'invalid', report: res.report }, 422);
    throw new HttpException({ code: res.reason }, 409);
  }
}

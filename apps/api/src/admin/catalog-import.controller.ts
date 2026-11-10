import { CATALOG_IMPORT_MIME } from '@lummi/contracts';
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
import type { Request, Response } from 'express';
import {
  CatalogImportService,
  type ImportLimits,
} from '../catalog-import/catalog-import.service';
import { SettingsService } from '../settings/settings.service';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';

/** Excel import and export of the catalog: the owner's (ADR 0017), like the rest of the catalog. */
@Controller('admin/catalog')
@UseGuards(StaffGuard, OwnerGuard)
export class CatalogImportController {
  constructor(
    @Inject(CatalogImportService) private readonly imports: CatalogImportService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  private async limits(): Promise<ImportLimits> {
    const [maxBytes, maxRows] = await Promise.all([
      this.settings.get('catalog.import.maxBytes'),
      this.settings.get('catalog.import.maxRows'),
    ]);
    return { maxBytes, maxRows };
  }

  private send(res: Response, bytes: Buffer, name: string) {
    res
      .status(200)
      .type(CATALOG_IMPORT_MIME)
      .setHeader('content-disposition', `attachment; filename="${name}"`)
      .setHeader('cache-control', 'no-store')
      .send(bytes);
  }

  @Get('export')
  async export(@Res() res: Response) {
    this.send(res, await this.imports.exportWorkbook(), 'LUMMI_Katalog.xlsx');
  }

  @Get('template')
  async template(@Res() res: Response) {
    this.send(res, await this.imports.templateWorkbook(), 'LUMMI_Katalog_shablon.xlsx');
  }

  /** The upload is the raw xlsx bytes; anything else is a 415, a body over the cap a 413. */
  private upload(req: Request): Buffer {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpException({ code: 'invalid', fields: ['file'] }, 415);
    }
    return body;
  }

  @Post('import/dry-run')
  async dryRun(@Req() req: Request) {
    return this.imports.dryRun(this.upload(req), await this.limits());
  }

  @Post('import/apply')
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
    if (res.ok) return { counts: res.counts, warnings: res.warnings };
    if (res.reason === 'stale') throw new HttpException({ code: 'stale' }, 409);
    throw new HttpException({ code: 'invalid', report: res.report }, 422);
  }
}

import { internalContract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { InternalGuard } from '../internal/internal.guard';
import { BackupWatch } from './backup-watch.service';

/** What the host's backup script calls (ADR 0031 network and secret, ADR 0035). */
@Controller()
@UseGuards(InternalGuard)
export class OpsController {
  constructor(@Inject(BackupWatch) private readonly backups: BackupWatch) {}

  @TsRestHandler(internalContract.backupReport)
  backupReport() {
    return tsRestHandler(internalContract.backupReport, async ({ body }) => {
      await this.backups.report(body.skipped);
      return { status: 200 as const, body: { ok: true as const } };
    });
  }
}

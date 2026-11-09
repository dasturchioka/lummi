import { adminContract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { AuditQueryService } from '../audit/audit-query.service';
import { OwnerGuard, StaffGuard } from '../staff/staff.guard';

/** Owner-only read access to the audit trail. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class AuditController {
  constructor(@Inject(AuditQueryService) private readonly audit: AuditQueryService) {}

  @TsRestHandler(adminContract.audit.list)
  list() {
    return tsRestHandler(adminContract.audit.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.audit.list(query),
    }));
  }

  @TsRestHandler(adminContract.audit.filters)
  filters() {
    return tsRestHandler(adminContract.audit.filters, async () => ({
      status: 200 as const,
      body: await this.audit.filters(),
    }));
  }
}

import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionGuard } from '../auth/session.guard';
import { SetsService } from './sets.service';

@Controller()
@UseGuards(SessionGuard)
export class SetsController {
  constructor(@Inject(SetsService) private readonly sets: SetsService) {}

  @TsRestHandler(contract.sets.discovery)
  discovery() {
    return tsRestHandler(contract.sets.discovery, async ({ query }) => ({
      status: 200 as const,
      body: await this.sets.discovery(query.vialMl),
    }));
  }

  @TsRestHandler(contract.sets.builder)
  builder() {
    return tsRestHandler(contract.sets.builder, async () => ({
      status: 200 as const,
      body: await this.sets.builder(),
    }));
  }
}

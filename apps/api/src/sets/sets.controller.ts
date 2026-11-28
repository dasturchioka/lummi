import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionGuard } from '../auth/session.guard';
import { SetsService } from './sets.service';

@Controller()
@UseGuards(SessionGuard)
export class SetsController {
  constructor(@Inject(SetsService) private readonly sets: SetsService) {}

  @TsRestHandler(contract.sets.list)
  list() {
    return tsRestHandler(contract.sets.list, async () => ({
      status: 200 as const,
      body: await this.sets.list(),
    }));
  }

  @TsRestHandler(contract.sets.discovery)
  discovery() {
    return tsRestHandler(contract.sets.discovery, async ({ query }) => {
      const set = await this.sets.discovery(query.key);
      return set
        ? { status: 200 as const, body: set }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(contract.sets.builder)
  builder() {
    return tsRestHandler(contract.sets.builder, async () => ({
      status: 200 as const,
      body: await this.sets.builder(),
    }));
  }
}

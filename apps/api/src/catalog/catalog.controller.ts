import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionGuard } from '../auth/session.guard';
import { CatalogService } from './catalog.service';

@Controller()
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @TsRestHandler(contract.catalog.fragrance)
  fragrance() {
    return tsRestHandler(contract.catalog.fragrance, async ({ params }) => {
      const card = await this.catalog.cardBySlug(params.slug);
      if (!card) return { status: 404 as const, body: { code: 'not_found' as const } };
      return { status: 200 as const, body: card };
    });
  }
}

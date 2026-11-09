import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionGuard } from '../auth/session.guard';
import { SearchService } from '../search/search.service';
import { CatalogService } from './catalog.service';

@Controller()
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(SearchService) private readonly search: SearchService,
  ) {}

  @TsRestHandler(contract.catalog.fragrance)
  fragrance() {
    return tsRestHandler(contract.catalog.fragrance, async ({ params }) => {
      const card = await this.catalog.cardBySlug(params.slug);
      if (!card) return { status: 404 as const, body: { code: 'not_found' as const } };
      return { status: 200 as const, body: card };
    });
  }

  @TsRestHandler(contract.catalog.suggest)
  suggest() {
    return tsRestHandler(contract.catalog.suggest, async ({ query }) => ({
      status: 200 as const,
      body: await this.search.suggest(query.q),
    }));
  }

  @TsRestHandler(contract.catalog.search)
  searchAll() {
    return tsRestHandler(contract.catalog.search, async ({ query }) => ({
      status: 200 as const,
      body: await this.search.search(query.q),
    }));
  }
}

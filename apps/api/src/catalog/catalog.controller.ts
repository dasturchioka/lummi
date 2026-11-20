import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
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
  fragrance(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.catalog.fragrance, async ({ params }) => {
      const card = await this.catalog.cardBySlug(params.slug, customerId);
      if (!card) return { status: 404 as const, body: { code: 'not_found' as const } };
      return { status: 200 as const, body: card };
    });
  }

  @TsRestHandler(contract.catalog.list)
  list() {
    return tsRestHandler(contract.catalog.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.catalog.list(query),
    }));
  }

  @TsRestHandler(contract.catalog.similar)
  similar() {
    return tsRestHandler(contract.catalog.similar, async ({ params }) => {
      const items = await this.catalog.similarTo(params.slug);
      if (!items) return { status: 404 as const, body: { code: 'not_found' as const } };
      return { status: 200 as const, body: { items } };
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

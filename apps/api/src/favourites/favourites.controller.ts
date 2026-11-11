import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { FavouritesService } from './favourites.service';

@Controller()
@UseGuards(SessionGuard)
export class FavouritesController {
  constructor(@Inject(FavouritesService) private readonly favourites: FavouritesService) {}

  @TsRestHandler(contract.favourites.ids)
  ids(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.favourites.ids, async () => ({
      status: 200 as const,
      body: await this.favourites.ids(customerId),
    }));
  }

  @TsRestHandler(contract.favourites.list)
  list(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.favourites.list, async () => ({
      status: 200 as const,
      body: await this.favourites.list(customerId),
    }));
  }

  @TsRestHandler(contract.favourites.add)
  add(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.favourites.add, async ({ params }) => {
      const body = await this.favourites.add(customerId, params.target);
      return body
        ? { status: 200 as const, body }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(contract.favourites.remove)
  remove(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.favourites.remove, async ({ params }) => ({
      status: 200 as const,
      body: await this.favourites.remove(customerId, params.target),
    }));
  }
}

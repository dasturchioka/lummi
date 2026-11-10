import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { CartService } from './cart.service';

const notFound = { status: 404 as const, body: { code: 'not_found' as const } };

@Controller()
@UseGuards(SessionGuard)
export class CartController {
  constructor(@Inject(CartService) private readonly cart: CartService) {}

  @TsRestHandler(contract.cart.get)
  get(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.get, async () => ({
      status: 200 as const,
      body: await this.cart.get(customerId),
    }));
  }

  @TsRestHandler(contract.cart.addLine)
  addLine(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.addLine, async ({ body }) => {
      const res = await this.cart.add(customerId, body.slug, body.ml, body.qty);
      if (res === 'not_found') return notFound;
      if (res === 'sold_out') return { status: 409 as const, body: { code: 'sold_out' as const } };
      return { status: 200 as const, body: await this.cart.get(customerId) };
    });
  }

  @TsRestHandler(contract.cart.addDiscovery)
  addDiscovery(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.addDiscovery, async ({ body }) => {
      const res = await this.cart.addDiscovery(customerId, body.qty);
      if (res.result !== 'ok') return { status: 409 as const, body: { code: 'sold_out' as const } };
      return { status: 200 as const, body: await this.cart.get(customerId) };
    });
  }

  @TsRestHandler(contract.cart.addBuilder)
  addBuilder(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.addBuilder, async ({ body }) => {
      const res = await this.cart.addBuilder(customerId, body.slugs, body.qty);
      switch (res.result) {
        case 'ok':
          return { status: 200 as const, body: await this.cart.get(customerId) };
        case 'not_found':
          return { status: 404 as const, body: { code: 'not_found' as const } };
        case 'invalid':
          return { status: 422 as const, body: { code: 'invalid' as const } };
        case 'unavailable':
          return {
            status: 409 as const,
            body: { code: 'unavailable' as const, slugs: res.slugs },
          };
        case 'sold_out':
          return { status: 409 as const, body: { code: 'sold_out' as const } };
      }
    });
  }

  @TsRestHandler(contract.cart.setQuantity)
  setQuantity(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.setQuantity, async ({ params, body }) => {
      if (!(await this.cart.setQuantity(customerId, params.lineId, body.qty))) return notFound;
      return { status: 200 as const, body: await this.cart.get(customerId) };
    });
  }

  @TsRestHandler(contract.cart.applyPromoCode)
  applyPromoCode(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.applyPromoCode, async ({ body }) => {
      const res = await this.cart.applyPromoCode(customerId, body.code);
      if (res.kind === 'too_many_attempts')
        return {
          status: 429 as const,
          body: { code: 'too_many_attempts' as const, retryAfterSeconds: res.retryAfterSeconds },
        };
      return { status: 200 as const, body: await this.cart.get(customerId) };
    });
  }

  @TsRestHandler(contract.cart.removePromoCode)
  removePromoCode(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.removePromoCode, async () => {
      await this.cart.clearPromoCode(customerId);
      return { status: 200 as const, body: await this.cart.get(customerId) };
    });
  }

  @TsRestHandler(contract.cart.removeLine)
  removeLine(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.removeLine, async ({ params }) => {
      await this.cart.remove(customerId, params.lineId);
      return { status: 200 as const, body: await this.cart.get(customerId) };
    });
  }
}

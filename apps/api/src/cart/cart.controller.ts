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

  @TsRestHandler(contract.cart.setQuantity)
  setQuantity(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.cart.setQuantity, async ({ params, body }) => {
      if (!(await this.cart.setQuantity(customerId, params.lineId, body.qty))) return notFound;
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

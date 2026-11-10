import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { CartService } from '../cart/cart.service';
import { OrderStatusService } from '../order-status/order-status.service';
import { OrdersService } from './orders.service';

const unauthorized = { status: 401 as const, body: { code: 'unauthorized' as const } };

/** Checkout and the «Заказы» tab. The customer is always the session's (ADR 0029). */
@Controller()
@UseGuards(SessionGuard)
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(CartService) private readonly cart: CartService,
  ) {}

  @TsRestHandler(contract.checkout.get)
  checkout(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.checkout.get, async ({ query }) => {
      const dto = await this.orders.checkout(customerId, query.regionId, query.item);
      if (dto === 'unknown_item')
        return { status: 404 as const, body: { code: 'not_found' as const } };
      return dto ? { status: 200 as const, body: dto } : unauthorized;
    });
  }

  @TsRestHandler(contract.orders.create)
  create(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.orders.create, async ({ body }) => {
      const out = await this.orders.create(customerId, body);
      if (!out) return unauthorized;
      switch (out.kind) {
        case 'created':
          return { status: 201 as const, body: out.order };
        case 'phone_required':
          return { status: 403 as const, body: { code: 'phone_required' as const } };
        case 'conflict':
          return { status: 409 as const, body: { code: out.code, checkout: out.checkout } };
        case 'try_again':
          return { status: 409 as const, body: { code: 'try_again' as const } };
        case 'invalid':
          return { status: 422 as const, body: { code: out.code } };
      }
    });
  }

  @TsRestHandler(contract.orders.list)
  list(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.orders.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.orders.list(customerId, query),
    }));
  }

  @TsRestHandler(contract.orders.get)
  get(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.orders.get, async ({ params }) => {
      const order = await this.orders.get(customerId, params.number);
      return order
        ? { status: 200 as const, body: order }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(contract.orders.cancel)
  cancel(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.orders.cancel, async ({ params, body }) => {
      const out = await this.status.cancelByCustomer(
        customerId,
        params.number,
        body.expectedStatus,
      );
      switch (out.kind) {
        case 'done':
          return { status: 200 as const, body: out.order };
        case 'conflict':
          return {
            status: 409 as const,
            body: { code: 'status_changed' as const, order: out.order },
          };
        case 'try_again':
          return { status: 409 as const, body: { code: 'try_again' as const } };
        case 'not_found':
          return { status: 404 as const, body: { code: 'not_found' as const } };
        case 'refused':
          // the shopper's own reason is always valid: only the table or the actor refuses it
          return {
            status: 403 as const,
            body: {
              code: out.code === 'not_allowed' ? ('not_allowed' as const) : ('forbidden' as const),
            },
          };
      }
    });
  }

  @TsRestHandler(contract.orders.repeat)
  repeat(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.orders.repeat, async ({ params }) => {
      const result = await this.cart.repeat(customerId, params.number);
      if (!result) return { status: 404 as const, body: { code: 'not_found' as const } };
      return { status: 200 as const, body: { result, cart: await this.cart.get(customerId) } };
    });
  }
}

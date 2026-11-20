import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { DeliveryService } from './delivery.service';

const notFound = { status: 404 as const, body: { code: 'not_found' as const } };

@Controller()
@UseGuards(SessionGuard)
export class DeliveryController {
  constructor(@Inject(DeliveryService) private readonly delivery: DeliveryService) {}

  @TsRestHandler(contract.delivery.regions)
  regions() {
    return tsRestHandler(contract.delivery.regions, async () => ({
      status: 200 as const,
      body: await this.delivery.regions(),
    }));
  }

  @TsRestHandler(contract.delivery.cities)
  cities() {
    return tsRestHandler(contract.delivery.cities, async ({ params }) => {
      const cities = await this.delivery.cities(params.regionId);
      return cities ? { status: 200 as const, body: cities } : notFound;
    });
  }

  @TsRestHandler(contract.delivery.points)
  points() {
    return tsRestHandler(contract.delivery.points, async ({ query }) => ({
      status: 200 as const,
      body: await this.delivery.points(query),
    }));
  }

  @TsRestHandler(contract.me.getDeliveryCity)
  getDeliveryCity(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.getDeliveryCity, async () => ({
      status: 200 as const,
      body: { deliveryCity: await this.delivery.getDeliveryCity(customerId) },
    }));
  }

  @TsRestHandler(contract.me.setDeliveryCity)
  setDeliveryCity(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.setDeliveryCity, async ({ body }) => {
      const res = await this.delivery.setDeliveryCity(customerId, body.regionId, body.city);
      if (res.ok) return { status: 200 as const, body: { deliveryCity: res.deliveryCity } };
      if (res.reason === 'unknown_city') {
        return { status: 422 as const, body: { code: 'unknown_city' as const } };
      }
      if (res.reason === 'customer_not_found') {
        return { status: 401 as const, body: { code: 'unauthorized' as const } };
      }
      return notFound;
    });
  }

  @TsRestHandler(contract.me.clearDeliveryCity)
  clearDeliveryCity(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.clearDeliveryCity, async () => {
      await this.delivery.clearDeliveryCity(customerId);
      return { status: 200 as const, body: { deliveryCity: null } };
    });
  }

  @TsRestHandler(contract.me.savedPoints)
  savedPoints(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.savedPoints, async () => ({
      status: 200 as const,
      body: await this.delivery.savedPoints(customerId),
    }));
  }

  @TsRestHandler(contract.me.removeSavedPoint)
  removeSavedPoint(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.removeSavedPoint, async ({ params }) => {
      if (!(await this.delivery.removeSavedPoint(customerId, params.id))) return notFound;
      return { status: 200 as const, body: await this.delivery.savedPoints(customerId) };
    });
  }
}

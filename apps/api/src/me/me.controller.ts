import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CustomersService } from '../auth/customers.service';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';

@Controller()
@UseGuards(SessionGuard)
export class MeController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @TsRestHandler(contract.me.get)
  get(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.get, async () => {
      const c = await this.customers.getById(customerId);
      if (!c) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      return {
        status: 200 as const,
        body: {
          id: c.id,
          telegramId: c.telegramId,
          firstName: c.firstName,
          lastName: c.lastName,
          username: c.username,
          language: c.language,
        },
      };
    });
  }
}

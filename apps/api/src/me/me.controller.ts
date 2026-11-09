import { contract, type CustomerDto } from '@lummi/contracts';
import type { CustomerRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CustomersService } from '../auth/customers.service';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';

function toDto(c: CustomerRow): CustomerDto {
  return {
    id: c.id,
    telegramId: c.telegramId,
    firstName: c.firstName,
    lastName: c.lastName,
    username: c.username,
    language: c.language,
    theme: c.theme,
  };
}

@Controller()
@UseGuards(SessionGuard)
export class MeController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @TsRestHandler(contract.me.get)
  get(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.get, async () => {
      const c = await this.customers.getById(customerId);
      if (!c) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      return { status: 200 as const, body: toDto(c) };
    });
  }

  @TsRestHandler(contract.me.updatePreferences)
  updatePreferences(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.updatePreferences, async ({ body }) => {
      const c = await this.customers.updatePreferences(customerId, body);
      if (!c) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      return { status: 200 as const, body: toDto(c) };
    });
  }
}

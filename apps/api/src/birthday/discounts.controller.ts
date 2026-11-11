import { contract } from '@lummi/contracts';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SessionCustomerId, SessionGuard } from '../auth/session.guard';
import { BirthdayService } from './birthday.service';

/** Profile «Мои скидки» and the one-time date of birth (ticket #30). */
@Controller()
@UseGuards(SessionGuard)
export class DiscountsController {
  constructor(@Inject(BirthdayService) private readonly birthday: BirthdayService) {}

  @TsRestHandler(contract.me.discounts)
  discounts(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.discounts, async () => {
      const body = await this.birthday.discounts(customerId);
      if (!body) return { status: 401 as const, body: { code: 'unauthorized' as const } };
      return { status: 200 as const, body };
    });
  }

  @TsRestHandler(contract.me.setBirthDate)
  setBirthDate(@SessionCustomerId() customerId: number) {
    return tsRestHandler(contract.me.setBirthDate, async ({ body }) => {
      const r = await this.birthday.setBirthDate(customerId, body);
      if (r.kind === 'ok') return { status: 200 as const, body: r.discounts };
      return { status: r.status, body: { code: r.code } };
    });
  }
}

import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, OwnerGuard, StaffGuard } from '../staff/staff.guard';
import { ShopCardService } from './shop-card.service';

/** Owner only (ADR 0017): the card shoppers transfer to; managers get 403 like the settings. */
@Controller()
@UseGuards(StaffGuard, OwnerGuard)
export class ShopCardController {
  constructor(@Inject(ShopCardService) private readonly cards: ShopCardService) {}

  @TsRestHandler(adminContract.shopCard.get)
  get() {
    return tsRestHandler(adminContract.shopCard.get, async () => ({
      status: 200 as const,
      body: await this.cards.get(),
    }));
  }

  @TsRestHandler(adminContract.shopCard.set)
  set(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.shopCard.set, async ({ body }) => ({
      status: 200 as const,
      body: await this.cards.set(actor, body),
    }));
  }

  @TsRestHandler(adminContract.shopCard.clear)
  clear(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.shopCard.clear, async () => ({
      status: 200 as const,
      body: await this.cards.clear(actor),
    }));
  }
}

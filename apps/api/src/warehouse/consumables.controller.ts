import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { ConsumablesService, type ConsumableFailure } from './consumables.service';

/** Every consumable failure as HTTP, in one place. */
function failure(f: ConsumableFailure) {
  switch (f.reason) {
    case 'not_found':
      return { status: 404 as const, body: { code: 'not_found' as const } };
    case 'link_taken':
      return { status: 409 as const, body: { code: 'link_taken' as const, fields: ['ml'] } };
    case 'changed':
      return { status: 409 as const, body: { code: 'changed' as const, current: f.current } };
    case 'try_again':
      return { status: 409 as const, body: { code: 'try_again' as const } };
  }
}

/** Consumables (ADR 0043): stock work, the owner's and the manager's (ADR 0017, 0041). */
@Controller()
@UseGuards(StaffGuard)
export class ConsumablesController {
  constructor(@Inject(ConsumablesService) private readonly items: ConsumablesService) {}

  @TsRestHandler(adminContract.consumables.list)
  list() {
    return tsRestHandler(adminContract.consumables.list, async () => ({
      status: 200 as const,
      body: { items: await this.items.list() },
    }));
  }

  @TsRestHandler(adminContract.consumables.create)
  create(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.consumables.create, async ({ body }) => {
      const res = await this.items.create(actor, body);
      if (res.ok) return { status: 201 as const, body: res.value };
      const f = failure(res);
      return f.status === 404 ? { status: 409 as const, body: { code: 'try_again' as const } } : f;
    });
  }

  @TsRestHandler(adminContract.consumables.update)
  update(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.consumables.update, async ({ params, body }) => {
      const res = await this.items.update(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.consumables.receive)
  receive(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.consumables.receive, async ({ params, body }) => {
      const res = await this.items.receive(actor, params.id, body);
      if (res.ok) return { status: 201 as const, body: res.value };
      return { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }

  @TsRestHandler(adminContract.consumables.count)
  count(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.consumables.count, async ({ params, body }) => {
      const res = await this.items.count(actor, params.id, body);
      return res.ok ? { status: 200 as const, body: res.value } : failure(res);
    });
  }

  @TsRestHandler(adminContract.consumables.history)
  history(@CurrentStaff() viewer: StaffRow) {
    return tsRestHandler(adminContract.consumables.history, async ({ params }) => {
      const h = await this.items.history(params.id, viewer);
      return h
        ? { status: 200 as const, body: h }
        : { status: 404 as const, body: { code: 'not_found' as const } };
    });
  }
}

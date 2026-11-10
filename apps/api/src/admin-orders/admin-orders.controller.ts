import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import { AdminOrdersService, type MoveOutcome } from './admin-orders.service';

const notFound = { status: 404 as const, body: { code: 'not_found' as const } };

/** A staff move's outcome as HTTP: the page now (200), or 404 / 409 / 422 / 403. */
function moveResponse(out: MoveOutcome) {
  switch (out.kind) {
    case 'done':
      return { status: 200 as const, body: out.order };
    case 'not_found':
      return notFound;
    case 'conflict':
      return { status: 409 as const, body: { code: out.code, order: out.order } };
    case 'try_again':
      return { status: 409 as const, body: { code: 'try_again' as const } };
    case 'refused':
      return out.code === 'forbidden'
        ? { status: 403 as const, body: { code: 'forbidden' as const } }
        : {
            status: 422 as const,
            body: { code: out.code, ...(out.max === undefined ? {} : { max: out.max }) },
          };
  }
}

/**
 * The orders panel (#33): owner and manager alike (ADR 0017: managers handle orders). The staff
 * member comes only from the verified session and is the actor of every move.
 */
@Controller()
@UseGuards(StaffGuard)
export class AdminOrdersController {
  constructor(@Inject(AdminOrdersService) private readonly orders: AdminOrdersService) {}

  @TsRestHandler(adminContract.orders.list)
  list() {
    return tsRestHandler(adminContract.orders.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.orders.list(query),
    }));
  }

  @TsRestHandler(adminContract.orders.get)
  get() {
    return tsRestHandler(adminContract.orders.get, async ({ params }) => {
      const page = await this.orders.page(params.number);
      return page ? { status: 200 as const, body: page } : notFound;
    });
  }

  @TsRestHandler(adminContract.orders.fulfil)
  fulfil(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.orders.fulfil, async ({ params, body }) =>
      moveResponse(await this.orders.fulfil(actor.id, params.number, body)),
    );
  }

  @TsRestHandler(adminContract.orders.cancel)
  cancel(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.orders.cancel, async ({ params, body }) =>
      moveResponse(await this.orders.cancel(actor.id, params.number, body)),
    );
  }

  @TsRestHandler(adminContract.orders.rejectReceipt)
  rejectReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.orders.rejectReceipt, async ({ params, body }) =>
      moveResponse(await this.orders.rejectReceipt(actor.id, params.number, body)),
    );
  }

  @TsRestHandler(adminContract.credits.list)
  credits() {
    return tsRestHandler(adminContract.credits.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.orders.credits(query),
    }));
  }
}

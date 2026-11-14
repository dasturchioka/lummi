import { adminContract } from '@lummi/contracts';
import type { StaffRow } from '@lummi/db';
import { Controller, Inject, UseGuards } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { CurrentStaff, StaffGuard } from '../staff/staff.guard';
import {
  AdminOrdersService,
  type CreditMarkAnswer,
  type MoveOutcome,
} from './admin-orders.service';

const notFound = { status: 404 as const, body: { code: 'not_found' as const } };

/**
 * Every staff move's outcome as HTTP, in one place (fulfil, cancel, return, reject, confirm, refund): the page now
 * (200), 404, 409 with the page as it is now, 422 with what to fix, or 403.
 */
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
            body: {
              code: out.code,
              ...(out.min === undefined ? {} : { min: out.min }),
              ...(out.max === undefined ? {} : { max: out.max }),
              ...(out.mismatch === undefined ? {} : { mismatch: out.mismatch }),
              ...(out.what === undefined ? {} : { what: out.what }),
            },
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

  @TsRestHandler(adminContract.orders.creditOptions)
  creditOptions() {
    return tsRestHandler(adminContract.orders.creditOptions, async ({ params }) => {
      const options = await this.orders.creditOptions(params.number);
      return options ? { status: 200 as const, body: options } : notFound;
    });
  }

  @TsRestHandler(adminContract.orders.confirmPayment)
  confirmPayment(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.orders.confirmPayment, async ({ params, body }) =>
      moveResponse(await this.orders.confirmPayment(actor.id, params.number, body)),
    );
  }

  @TsRestHandler(adminContract.orders.rejectReceipt)
  rejectReceipt(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.orders.rejectReceipt, async ({ params, body }) =>
      moveResponse(await this.orders.rejectReceipt(actor.id, params.number, body)),
    );
  }

  @TsRestHandler(adminContract.orders.return)
  returnOrder(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.orders.return, async ({ params, body }) =>
      moveResponse(await this.orders.returnOrder(actor.id, params.number, body)),
    );
  }

  @TsRestHandler(adminContract.orders.refund)
  refund(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.orders.refund, async ({ params, body }) =>
      moveResponse(await this.orders.refund(actor.id, params.number, body)),
    );
  }

  @TsRestHandler(adminContract.credits.list)
  credits() {
    return tsRestHandler(adminContract.credits.list, async ({ query }) => ({
      status: 200 as const,
      body: await this.orders.credits(query),
    }));
  }

  @TsRestHandler(adminContract.credits.markNotForOrder)
  markNotForOrder(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.credits.markNotForOrder, async ({ params, body }) =>
      markResponse(await this.orders.markNotForOrder(actor.id, params.id, body.note)),
    );
  }

  @TsRestHandler(adminContract.credits.unmarkNotForOrder)
  unmarkNotForOrder(@CurrentStaff() actor: StaffRow) {
    return tsRestHandler(adminContract.credits.unmarkNotForOrder, async ({ params }) => {
      const out = await this.orders.unmarkNotForOrder(actor.id, params.id);
      // an unmark has no note to refuse
      if (out.kind === 'note_too_long') throw new Error('unmark answered note_too_long');
      return markResponse(out);
    });
  }
}

/** A «Не для заказа» mark or unmark as HTTP (#49): the credit now, 404, or 409 with the credit as it is. */
function markResponse(out: CreditMarkAnswer) {
  switch (out.kind) {
    case 'done':
      return { status: 200 as const, body: out.credit };
    case 'not_found':
      return notFound;
    case 'credit_taken':
    case 'credit_changed':
      return { status: 409 as const, body: { code: out.kind, credit: out.credit } };
    case 'note_too_long':
      return { status: 422 as const, body: { code: out.kind, max: out.max } };
  }
}

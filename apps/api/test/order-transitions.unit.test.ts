import {
  ORDER_ACTIONS,
  ORDER_ACTOR_TYPES,
  ORDER_STATUSES,
  type OrderAction,
  type OrderActorType,
  type OrderStatus,
} from '@lummi/contracts';
import { describe, expect, it } from 'vitest';
import { planTransition } from '../src/order-status/machine';

/**
 * The allowed moves, written out from ADR 0011 and ADR 0006 (not read from the code's table):
 * `from|action` -> the status it leads to and who may make it.
 */
const ALLOWED: Record<string, { to: OrderStatus; actors: OrderActorType[] }> = {
  // the unpaid end
  'awaiting_payment|submit_receipt': { to: 'receipt_review', actors: ['customer'] },
  'receipt_review|confirm_payment': { to: 'payment_confirmed', actors: ['ai', 'staff'] },
  // a credit with no receipt, linked to the order by hand (TZ §4: «Поступления без чека … вручную»)
  'awaiting_payment|confirm_payment': { to: 'payment_confirmed', actors: ['staff'] },
  'receipt_review|reject_receipt': { to: 'awaiting_payment', actors: ['staff'] },
  'receipt_review|payment_not_found': { to: 'awaiting_payment', actors: ['system'] },
  // fulfilment, one step at a time, by a manager
  'payment_confirmed|accept': { to: 'accepted', actors: ['staff'] },
  'accepted|start_assembly': { to: 'assembling', actors: ['staff'] },
  'assembling|hand_to_bts': { to: 'handed_to_bts', actors: ['staff'] },
  'handed_to_bts|deliver': { to: 'delivered', actors: ['staff'] },
  // a whole delivered order came back (ADR 0006)
  'delivered|return': { to: 'returned', actors: ['staff'] },
  // «Отменён» from any state before «Доставлен»; the shopper and the expiry sweep only while unpaid
  'awaiting_payment|cancel': { to: 'cancelled', actors: ['customer', 'staff', 'system'] },
  'receipt_review|cancel': { to: 'cancelled', actors: ['staff'] },
  'payment_confirmed|cancel': { to: 'cancelled', actors: ['staff'] },
  'accepted|cancel': { to: 'cancelled', actors: ['staff'] },
  'assembling|cancel': { to: 'cancelled', actors: ['staff'] },
  'handed_to_bts|cancel': { to: 'cancelled', actors: ['staff'] },
};

/** A payload each action accepts from that actor, so the table checks stand alone. */
function validPayload(action: OrderAction, actor: OrderActorType, from: OrderStatus): unknown {
  switch (action) {
    case 'cancel':
      if (actor === 'customer') return { reason: 'customer_cancelled' };
      if (actor === 'system') return { reason: 'reserve_expired' };
      return { reason: from === 'handed_to_bts' ? 'not_collected_at_bts' : 'out_of_stock' };
    case 'reject_receipt':
      return { reason: 'Сумма на чеке не совпадает с заказом' };
    case 'hand_to_bts':
      return { trackingNumber: 'BTS-778812' };
    case 'return':
      return { reason: 'Флакон протёк', lines: [{ position: 0, backToStock: false }] };
    default:
      return undefined;
  }
}

const triples = ORDER_STATUSES.flatMap((from) =>
  ORDER_ACTIONS.flatMap((action) => ORDER_ACTOR_TYPES.map((actor) => ({ from, action, actor }))),
);

describe('the transition table (ADR 0011, 0006)', () => {
  const allowed = triples.filter(({ from, action, actor }) =>
    ALLOWED[`${from}|${action}`]?.actors.includes(actor),
  );
  const refused = triples.filter(
    ({ from, action, actor }) => !ALLOWED[`${from}|${action}`]?.actors.includes(actor),
  );

  it('covers every pair: 9 statuses x 10 actions x 4 actors', () => {
    expect(triples).toHaveLength(9 * 10 * 4);
    expect(allowed).toHaveLength(19);
  });

  it.each(allowed)('allows $action from $from by $actor', ({ from, action, actor }) => {
    const plan = planTransition(from, action, actor, validPayload(action, actor, from));
    expect(plan).toMatchObject({ ok: true, to: ALLOWED[`${from}|${action}`]!.to });
  });

  it.each(refused)('refuses $action from $from by $actor', ({ from, action, actor }) => {
    const plan = planTransition(from, action, actor, validPayload(action, actor, from));
    // a move that does not exist from that status, or one this actor may not make
    expect(plan).toEqual({
      ok: false,
      code: ALLOWED[`${from}|${action}`] ? 'forbidden' : 'not_allowed',
    });
  });

  it('ends at «Доставлен» -> «Возвращён» and at «Отменён»: nothing leaves them', () => {
    for (const from of ['returned', 'cancelled'] as const)
      for (const action of ORDER_ACTIONS)
        for (const actor of ORDER_ACTOR_TYPES)
          expect(planTransition(from, action, actor, validPayload(action, actor, from)).ok).toBe(
            false,
          );
  });
});

describe('required payloads', () => {
  const invalid = { ok: false, code: 'invalid_payload' };

  it('a cancel always has a reason, and only one its actor may give', () => {
    expect(planTransition('awaiting_payment', 'cancel', 'staff', {})).toEqual(invalid);
    expect(planTransition('awaiting_payment', 'cancel', 'staff', undefined)).toEqual(invalid);
    // the shopper cancels for themselves, the sweep only on expiry, staff with a TZ reason
    expect(
      planTransition('awaiting_payment', 'cancel', 'customer', { reason: 'out_of_stock' }),
    ).toEqual(invalid);
    expect(
      planTransition('awaiting_payment', 'cancel', 'system', { reason: 'customer_cancelled' }),
    ).toEqual(invalid);
    expect(
      planTransition('awaiting_payment', 'cancel', 'staff', { reason: 'reserve_expired' }),
    ).toEqual(invalid);
    expect(planTransition('accepted', 'cancel', 'staff', { reason: 'nope' })).toEqual(invalid);
    for (const reason of [
      'out_of_stock',
      'customer_refused',
      'unreachable',
      'payment_not_received',
    ] as const)
      expect(planTransition('assembling', 'cancel', 'staff', { reason })).toMatchObject({
        ok: true,
        payload: { reason },
      });
  });

  it('«Не забрал в BTS» only cancels a parcel that was handed to BTS', () => {
    expect(
      planTransition('assembling', 'cancel', 'staff', { reason: 'not_collected_at_bts' }),
    ).toEqual(invalid);
    expect(
      planTransition('handed_to_bts', 'cancel', 'staff', {
        reason: 'not_collected_at_bts',
        note: '  Вернулся в Термез  ',
      }),
    ).toEqual({
      ok: true,
      to: 'cancelled',
      payload: { reason: 'not_collected_at_bts', note: 'Вернулся в Термез' },
    });
  });

  it('«Передан в BTS» needs the tracking number', () => {
    expect(planTransition('assembling', 'hand_to_bts', 'staff', {})).toEqual(invalid);
    expect(planTransition('assembling', 'hand_to_bts', 'staff', { trackingNumber: '  ' })).toEqual(
      invalid,
    );
    expect(
      planTransition('assembling', 'hand_to_bts', 'staff', { trackingNumber: ' 1234 5678 ' }),
    ).toMatchObject({ ok: true, payload: { trackingNumber: '1234 5678' } });
  });

  it('a rejected receipt carries the manager’s reason', () => {
    expect(planTransition('receipt_review', 'reject_receipt', 'staff', {})).toEqual(invalid);
    expect(planTransition('receipt_review', 'reject_receipt', 'staff', { reason: ' ' })).toEqual(
      invalid,
    );
  });

  it('a return carries a reason and a back-to-stock flag per line', () => {
    expect(
      planTransition('delivered', 'return', 'staff', {
        lines: [{ position: 0, backToStock: true }],
      }),
    ).toEqual(invalid);
    expect(planTransition('delivered', 'return', 'staff', { reason: 'Не подошёл' })).toEqual(
      invalid,
    );
    expect(
      planTransition('delivered', 'return', 'staff', { reason: 'Не подошёл', lines: [] }),
    ).toEqual(invalid);
    expect(
      planTransition('delivered', 'return', 'staff', {
        reason: 'Не подошёл',
        lines: [{ position: 0 }],
      }),
    ).toEqual(invalid);
  });

  it('a move that needs nothing takes nothing', () => {
    expect(planTransition('payment_confirmed', 'accept', 'staff', undefined)).toMatchObject({
      ok: true,
    });
    expect(planTransition('payment_confirmed', 'accept', 'staff', {})).toMatchObject({ ok: true });
    expect(
      planTransition('payment_confirmed', 'accept', 'staff', { trackingNumber: 'x' }),
    ).toEqual(invalid);
  });
});

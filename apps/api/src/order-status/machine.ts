import {
  cancelReasonsFor,
  findTransition,
  transitionPayloadSchemas,
  type OrderAction,
  type OrderActorType,
  type OrderStatus,
  type TransitionPayload,
  type TransitionRefusal,
} from '@lummi/contracts';

export type Plan<A extends OrderAction = OrderAction> =
  | { ok: true; to: OrderStatus; payload: TransitionPayload<A> }
  | { ok: false; code: TransitionRefusal };

/**
 * Whether `actor` may make `action` from `from`, and where it leads: the table (ADR 0011, 0006),
 * then the actor's permission, then the payload. Pure, so every pair is unit-tested; the service
 * runs it before it touches the order.
 * - `not_allowed`: no such move from that status (a terminal status, a skipped step);
 * - `forbidden`: the move exists, but not for this actor (a shopper confirming a payment);
 * - `invalid_payload`: a missing tracking number or reason, or a reason this actor may not give.
 */
export function planTransition<A extends OrderAction>(
  from: OrderStatus,
  action: A,
  actor: OrderActorType,
  payload: unknown,
): Plan<A> {
  const edge = findTransition(from, action);
  if (!edge) return { ok: false, code: 'not_allowed' };
  if (!edge.actors.includes(actor)) return { ok: false, code: 'forbidden' };
  const parsed = transitionPayloadSchemas[action].safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'invalid_payload' };
  const data = parsed.data as TransitionPayload<A>;
  if (action === 'cancel') {
    const { reason } = data as TransitionPayload<'cancel'>;
    if (!cancelReasonsFor(actor, from).includes(reason))
      return { ok: false, code: 'invalid_payload' };
  }
  return { ok: true, to: edge.to, payload: data };
}

import type { Discount, OrderStatus } from '@lummi/contracts';
import { fill, formatDateTime } from '@lummi/i18n';
import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Figure } from '../ui/Figure';
import { DiscountRow } from '../ui/DiscountRow';
import { CheckIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { useOrdersText } from './queries';

/** Paid and on its way: these statuses read as confirmed (Sage Wash); the rest are pending or over. */
const CONFIRMED: ReadonlySet<OrderStatus> = new Set([
  'payment_confirmed',
  'accepted',
  'assembling',
  'handed_to_bts',
  'delivered',
]);

/** Over: no longer pending and not on its way. */
const ENDED: ReadonlySet<OrderStatus> = new Set(['cancelled', 'returned']);

/**
 * DESIGN.md Payment: the status pill is Milk Field (pending) or Sage Wash with Sage Ink
 * (confirmed); an order that is over (cancelled, returned) steps back to a hairline outline with
 * Muted Ink, so it never reads as waiting for the shopper.
 */
export function StatusPill({ status }: { status: OrderStatus }) {
  const o = useOrdersText();
  const tone = CONFIRMED.has(status)
    ? 'bg-sage-wash text-sage-ink'
    : ENDED.has(status)
      ? 'inset-line text-muted'
      : 'bg-field text-ink';
  return (
    <span
      data-testid="status"
      className={`type-small inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 font-medium whitespace-nowrap ${tone}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-pill bg-current" />
      {o.orders.status[status]}
    </span>
  );
}

/** A section title over a block: Tenor caps (DESIGN.md Section), as «ПОЛУЧАТЕЛЬ» in mockup 06. */
export function SectionTitle({
  children,
  flush = false,
}: {
  children: ReactNode;
  flush?: boolean;
}) {
  // `flush`: the parent's gap already spaces it (a flex column of fields)
  return <h2 className={`type-section text-ink ${flush ? '' : 'mb-3'}`}>{children}</h2>;
}

/**
 * The money of a checkout or an order exactly as the server worked it out (ADR 0001), in the
 * cart's dark totals block (approved variant 2): items, the one discount with its source, BTS
 * delivery to the named place, a hairline and «Итого». Labels at 75 % Milk, values at full Milk;
 * the discount and a free delivery in Dark Sage Ink. The 409 sheet passes what the shopper had
 * confirmed: a total, a delivery fee that differ show struck in front of the new ones, and a
 * discount that is gone or changed shows struck above the new one, so «the total stayed» and
 * «the total grew» both read from the numbers. Display only: no arithmetic.
 */
export function MoneySummary({
  itemCount,
  itemsSubtotal,
  discount,
  deliveryFee,
  total,
  place,
  was,
  wasDiscount,
  wasDeliveryFee,
}: {
  itemCount: number;
  itemsSubtotal: number;
  discount: Discount | null;
  deliveryFee: number;
  total: number;
  /** The city or region delivery goes to; null before one is chosen. */
  place: string | null;
  /** The total the shopper confirmed before it changed. */
  was?: number;
  /** The discount the shopper confirmed (the 409 sheet). */
  wasDiscount?: Discount | null;
  /** The delivery fee the shopper confirmed (the 409 sheet). */
  wasDeliveryFee?: number;
}) {
  const { t } = usePrefs();
  const o = useOrdersText();
  const row = 'flex items-baseline justify-between gap-4';
  const changed = was !== undefined && was !== total;
  // both come from the server's quotes, serialised the same way
  const lostDiscount =
    wasDiscount && JSON.stringify(wasDiscount) !== JSON.stringify(discount) ? wasDiscount : null;
  const deliveryChanged = wasDeliveryFee !== undefined && wasDeliveryFee !== deliveryFee;
  return (
    <section
      aria-label={t.cart.total}
      data-testid="money-summary"
      className="rounded-card bg-totals p-4 text-totals-ink"
    >
      <dl className="type-body flex flex-col gap-2.5">
        <div className={row}>
          <dt className="min-w-0 text-totals-ink/75">
            {fill(o.checkout.items, { n: String(itemCount) })}
          </dt>
          <dd className="type-price">
            <Figure amount={itemsSubtotal} />
          </dd>
        </div>
        {lostDiscount ? <DiscountRow discount={lostDiscount} was={o.checkout.changedWas} /> : null}
        {discount ? <DiscountRow discount={discount} /> : null}
        <div className={row}>
          <dt className="min-w-0 text-pretty text-totals-ink/75">
            {place ? fill(t.cart.delivery, { city: place }) : t.cart.deliveryNoCity}
          </dt>
          <dd className="type-price flex flex-wrap items-baseline justify-end gap-x-2.5 gap-y-0.5">
            {deliveryChanged ? (
              <s className="font-medium text-totals-ink/60 decoration-totals-ink/60">
                <span className="sr-only">{o.checkout.changedWas}: </span>
                <Money amount={wasDeliveryFee} className="!font-medium" />
              </s>
            ) : null}
            {deliveryFee === 0 && itemsSubtotal > 0 ? (
              <span className="text-totals-accent">{t.cart.deliveryFree}</span>
            ) : (
              <Figure amount={deliveryFee} />
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-3.5 flex items-baseline justify-between gap-4 border-t border-totals-ink/20 pt-3.5">
        <span className="type-total">{t.cart.total}</span>
        {/* a changed total: the old one struck in front, and the pair wraps rather than squeezes */}
        <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2.5 gap-y-0.5">
          {changed ? (
            <s className="type-price font-medium text-totals-ink/60 decoration-totals-ink/60">
              <span className="sr-only">{o.checkout.changedWas}: </span>
              <Money amount={was} className="!font-medium" />
            </s>
          ) : null}
          <span className="type-total" data-testid="total">
            {changed ? <span className="sr-only">{o.checkout.changedNow}: </span> : null}
            <Figure amount={total} />
          </span>
        </span>
      </div>
    </section>
  );
}

type StepState = 'done' | 'now' | 'later';

/** Which step of the timeline an order is on; null for an order that left it (cancelled). */
function currentStep(status: OrderStatus): number | null {
  switch (status) {
    case 'awaiting_payment':
    case 'receipt_review':
      return 1;
    case 'payment_confirmed':
    case 'accepted':
    case 'assembling':
      return 2;
    case 'handed_to_bts':
      return 3;
    case 'delivered':
    case 'returned':
      return 5;
    case 'cancelled':
      return null;
  }
}

/**
 * The order-status timeline (DESIGN.md Sage Thread, mockup 12): done steps are Sage dots with a
 * check joined by a 2 px Sage line, the current step a ringed dot, later ones hollow. Derived
 * from the one status (ADR 0011); only the creation carries a time until #24 adds the events.
 */
export function Timeline({ status, createdAt }: { status: OrderStatus; createdAt: string }) {
  const { language } = usePrefs();
  const o = useOrdersText();
  const current = currentStep(status);
  if (current === null) return null;
  const steps: { title: string; note?: string }[] = [
    { title: o.orders.steps.created, note: formatDateTime(createdAt, language) },
    { title: o.orders.steps.payment },
    { title: o.orders.steps.assembling },
    { title: o.orders.steps.handedToBts },
    { title: o.orders.steps.delivered },
  ];
  return (
    <ol className="flex flex-col" data-testid="timeline">
      {steps.map((step, i) => {
        const state: StepState = i < current ? 'done' : i === current ? 'now' : 'later';
        const last = i === steps.length - 1;
        const note = state === 'now' ? o.orders.status[status] : step.note;
        return (
          <li key={step.title} className="relative flex gap-3.5 pb-4 last:pb-0">
            {last ? null : (
              <span
                aria-hidden="true"
                // Sage up to the current step (mockup 12), hairline after it
                className={`absolute top-6 bottom-0 left-[11px] w-0.5 rounded-[2px] ${
                  i < current ? 'bg-sage' : 'bg-line'
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-pill ${
                state === 'done'
                  ? 'bg-sage text-on-sage'
                  : state === 'now'
                    ? 'bg-card shadow-[inset_0_0_0_1.5px_var(--c-ink)]'
                    : 'bg-card inset-line'
              }`}
            >
              {state === 'done' ? <CheckIcon size={14} strokeWidth={2} /> : null}
              {state === 'now' ? <span className="size-2 rounded-pill bg-ink" /> : null}
            </span>
            <div className="min-w-0 pt-0.5">
              <p
                className={`type-row leading-tight ${state === 'later' ? 'text-muted' : 'text-ink'} ${
                  state === 'now' ? 'font-semibold' : ''
                }`}
              >
                {step.title}
              </p>
              {note && state !== 'later' ? (
                <p className="type-small mt-0.5 text-muted">{note}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

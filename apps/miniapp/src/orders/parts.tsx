import type { Discount, OrderStatus } from '@lummi/contracts';
import { fill, formatDateTime } from '@lummi/i18n';
import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Card } from '../ui/Card';
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

/** DESIGN.md Payment: the status pill is Milk Field (pending) or Sage Wash with Sage Ink (confirmed). */
export function StatusPill({ status }: { status: OrderStatus }) {
  const o = useOrdersText();
  const ok = CONFIRMED.has(status);
  return (
    <span
      data-testid="status"
      className={`type-small inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 font-medium whitespace-nowrap ${
        ok ? 'bg-sage-wash text-sage-ink' : 'bg-field text-ink'
      }`}
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

function discountSource(d: Discount, t: ReturnType<typeof usePrefs>['t']): string {
  if (d.type === 'promo_code') return fill(t.cart.sourcePromo, { code: d.code });
  if (d.type === 'birthday_coupon') return t.cart.sourceBirthday;
  return d.source === 'set' ? t.cart.sourceSet : t.cart.sourceSingle;
}

/**
 * The money of a checkout or an order exactly as the server worked it out (ADR 0001): items, the
 * one discount with its source, BTS delivery to the named place, a hairline and «Итого». A white
 * card (mockup 06 «Ваш заказ»); the discount and a free delivery are Sage Ink.
 */
export function MoneySummary({
  itemCount,
  itemsSubtotal,
  discount,
  deliveryFee,
  total,
  place,
}: {
  itemCount: number;
  itemsSubtotal: number;
  discount: Discount | null;
  deliveryFee: number;
  total: number;
  /** The city or region delivery goes to; null before one is chosen. */
  place: string | null;
}) {
  const { t } = usePrefs();
  const o = useOrdersText();
  const row = 'flex items-baseline justify-between gap-4';
  return (
    <Card className="p-4" data-testid="money-summary">
      <dl className="type-body flex flex-col gap-2.5">
        <div className={row}>
          <dt className="min-w-0 text-muted">{fill(o.checkout.items, { n: String(itemCount) })}</dt>
          <dd>
            <Money amount={itemsSubtotal} />
          </dd>
        </div>
        {discount ? (
          <div className={`${row} text-sage-ink`}>
            <dt className="flex min-w-0 flex-col">
              <span>{t.cart.discount}</span>
              <span className="type-caption [overflow-wrap:anywhere]">
                {discountSource(discount, t)}
              </span>
            </dt>
            <dd className="type-price whitespace-nowrap">
              −<Money amount={discount.amount} />
            </dd>
          </div>
        ) : null}
        <div className={row}>
          <dt className="min-w-0 text-pretty text-muted">
            {place ? fill(t.cart.delivery, { city: place }) : t.cart.deliveryNoCity}
          </dt>
          <dd>
            {deliveryFee === 0 && itemsSubtotal > 0 ? (
              <span className="type-price text-sage-ink">{t.cart.deliveryFree}</span>
            ) : (
              <Money amount={deliveryFee} />
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-3.5 flex items-baseline justify-between gap-4 border-t border-line pt-3.5">
        <span className="type-total">{t.cart.total}</span>
        <span className="type-total" data-testid="total">
          <Money amount={total} className="!text-[16px]" />
        </span>
      </div>
    </Card>
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

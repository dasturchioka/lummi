import type { OrderDto, OrderLineDto } from '@lummi/contracts';
import { fill, formatDateTime, formatPhone } from '@lummi/i18n';
import { useParams, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PointMeta } from '../delivery/Hours';
import { MoneySummary, SectionTitle, StatusPill, Timeline } from '../orders/parts';
import { useOrder, useOrdersText } from '../orders/queries';
import { usePrefs } from '../lib/prefs';
import { openManagerChat } from '../lib/telegram';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { attribution } from '../ui/FragranceListCard';
import { BoxIcon, ClockIcon, GiftIcon, PinIcon } from '../ui/icons';
import { MetaLine } from '../ui/MetaLine';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { Thumb } from '../ui/Thumb';

/**
 * A line as bought (DESIGN.md compact row): thumbnail, «по мотивам» and the italic name over the
 * full width, then a receipt row: volume × qty, and the line total at its end. With no stepper on
 * an order, the price waits on that row instead of squeezing the attribution beside it.
 */
function Line({ line }: { line: OrderLineDto }) {
  const { t, language } = usePrefs();
  const o = useOrdersText();
  return (
    <li className="flex gap-3 p-3" data-testid="order-line">
      <Thumb photo={line.photo} className="w-12" />
      <div className="flex min-w-0 flex-1 flex-col">
        {line.brand ? (
          <p className="type-label text-pretty text-muted [overflow-wrap:anywhere]">
            {attribution(t.card.basedOn, line.brand)}
          </p>
        ) : null}
        <p className="type-name mt-px text-[18px] text-pretty text-ink [overflow-wrap:anywhere]">
          {line.name[language]}
        </p>
        {line.setComposition ? (
          <p className="type-small mt-0.5 text-muted">
            {line.setComposition.map((f) => f.name).join(' · ')}
          </p>
        ) : null}
        <div className="mt-auto flex items-baseline justify-between gap-3 pt-1">
          <p className="type-small min-w-0 text-muted">
            {line.kind === 'builder_set'
              ? `${o.orders.setOf} · ${fill(o.orders.units, { qty: String(line.qty) })}`
              : fill(o.orders.qty, { ml: String(line.ml), qty: String(line.qty) })}
          </p>
          <Money
            amount={line.lineTotal}
            className={`shrink-0 ${line.markedDown ? 'text-sage-ink' : ''}`}
          />
        </div>
      </div>
    </li>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-[26px]">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** Where the parcel goes and who collects it: the point as it was chosen, or the typed address, flagged. */
function DeliveryCard({ order }: { order: OrderDto }) {
  const { language } = usePrefs();
  const o = useOrdersText();
  const { point, typed, region } = order.delivery;
  return (
    <Card className="divide-y divide-line overflow-hidden" data-testid="order-delivery">
      <div className="flex gap-3 p-4">
        <span className="mt-0.5 shrink-0 text-ink">
          <PinIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          {point ? (
            <>
              <p className="type-row font-semibold break-words">{point.name}</p>
              <p className="type-body break-words">{point.address}</p>
              <PointMeta
                className="type-small mt-0.5 text-muted"
                landmark={point.landmark}
                hours={point.hours}
              />
              <MetaLine
                className="type-small mt-0.5 text-muted"
                parts={[point.city, region[language]]}
              />
            </>
          ) : (
            <>
              <p className="type-row font-semibold break-words">{region[language]}</p>
              <p className="type-body break-words whitespace-pre-line">{typed}</p>
              <p className="type-small mt-1 text-muted">
                {o.orders.typed}. {o.orders.typedNote}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="p-4">
        <p className="type-small text-muted">{o.orders.recipient}</p>
        <p className="type-row mt-0.5 break-words">{order.recipient.name}</p>
        <p className="type-body whitespace-nowrap tabular-nums">
          {formatPhone(order.recipient.phone)}
        </p>
      </div>
    </Card>
  );
}

/**
 * What to transfer while the order waits for payment (mockup 07, «Сумма к переводу»): the
 * server's Amount due at 28 px, then how long the fragrances stay reserved. The card number,
 * copy buttons and receipt upload join it with the payment screen (#28).
 */
function AmountDue({ order }: { order: OrderDto }) {
  const { language } = usePrefs();
  const o = useOrdersText();
  const [before = '', after = ''] = o.orders.reservedUntil.split('{until}');
  // the time keeps the word after it (UZ «15:03 gacha») on its line: the Unbroken Date Rule
  const [, glue = '', rest = ''] = /^(\s?\S*)(.*)$/s.exec(after) ?? [];
  return (
    <Card className="mt-3 p-4" data-testid="amount-due">
      <p className="type-small text-muted">{o.orders.amountDue}</p>
      <Money amount={order.amountDue} size="amount" className="mt-1 block" />
      <p
        className="type-small mt-3.5 flex items-start gap-2 border-t border-line pt-3.5 text-ink"
        data-testid="reserved-until"
      >
        <span className="shrink-0 text-muted">
          <ClockIcon size={18} />
        </span>
        <span className="pt-px text-pretty">
          {before}
          <span className="whitespace-nowrap">
            <b className="font-semibold">{formatDateTime(order.reserveUntil, language)}</b>
            {glue}
          </span>
          {rest}
        </span>
      </p>
    </Card>
  );
}

/** The number is known before the order is: the title stands from the first frame, the rest holds its shape. */
function Loading({ title }: { title: string }) {
  return (
    <Screen>
      <ScreenHeader title={title} />
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-36" rounded="pill" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-[148px] w-full" rounded="card" />
        <Skeleton className="h-[236px] w-full" rounded="card" />
      </div>
    </Screen>
  );
}

/**
 * Order detail: status (with the timeline it implies), what was bought, the money, the BTS point,
 * the gift mark and «Написать менеджеру». All from the order's snapshot, so it reads the same
 * whatever happened to prices or points since, and whether or not the bot may write.
 */
export function Order() {
  const o = useOrdersText();
  const router = useRouter();
  const { number } = useParams({ from: '/orders/$number' });
  const n = Number(number);
  const query = useOrder(n);

  if (query.isError && query.data === undefined)
    return (
      <Screen>
        <ScreenHeader title={fill(o.orders.number, { number })} />
        <ErrorState fill retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </Screen>
    );
  if (query.data === undefined) return <Loading title={fill(o.orders.number, { number })} />;
  const order = query.data;
  if (order === null)
    return (
      <Screen>
        <ScreenHeader title={o.orders.title} />
        <EmptyState
          fill
          icon={<BoxIcon size={28} />}
          title={o.orders.notFoundTitle}
          text={o.orders.notFoundText}
          action={
            <Button block onClick={() => void router.navigate({ to: '/orders' })}>
              {o.orders.toOrders}
            </Button>
          }
        />
      </Screen>
    );
  return <OrderView order={order} />;
}

/** One order as its snapshot froze it; «Написать менеджеру» goes to the shop's manager account (setting `shop.managerUsername`, via the customer's config). */
export function OrderView({ order }: { order: OrderDto }) {
  const { language, customer } = usePrefs();
  const o = useOrdersText();
  const managerUsername = customer?.config.managerUsername;
  const place = order.delivery.point?.city ?? order.delivery.region[language];
  const itemCount = order.lines.reduce((sum, l) => sum + l.qty, 0);
  return (
    <Screen>
      <ScreenHeader title={fill(o.orders.number, { number: String(order.number) })} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusPill status={order.status} />
        <span className="type-small text-muted">{formatDateTime(order.createdAt, language)}</span>
      </div>

      {order.status === 'awaiting_payment' ? <AmountDue order={order} /> : null}

      {order.status !== 'cancelled' ? (
        <Card className="mt-3 p-4">
          <Timeline status={order.status} createdAt={order.createdAt} />
        </Card>
      ) : null}

      {order.gift.isGift ? (
        <Card className="mt-3 flex gap-3 p-4" data-testid="gift-mark">
          <span className="mt-0.5 shrink-0 text-ink">
            <GiftIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="type-row font-semibold text-ink">{o.orders.giftTitle}</p>
            <p className="type-small mt-0.5 text-muted">{o.orders.giftNote}</p>
            {order.gift.message ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="type-small text-muted">{o.orders.greeting}</p>
                <p className="type-body mt-0.5 break-words whitespace-pre-line text-ink [overflow-wrap:anywhere]">
                  «{order.gift.message}»
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Block title={o.orders.lines}>
        <Card as="ul" className="divide-y divide-line overflow-hidden">
          {order.lines.map((line, i) => (
            <Line key={i} line={line} />
          ))}
        </Card>
        <div className="mt-3">
          <MoneySummary
            itemCount={itemCount}
            itemsSubtotal={order.itemsSubtotal}
            discount={order.discount}
            deliveryFee={order.deliveryFee}
            total={order.total}
            place={place}
          />
        </div>
      </Block>

      <Block title={o.orders.delivery}>
        <DeliveryCard order={order} />
      </Block>

      {order.comment ? (
        <Block title={o.orders.comment}>
          <Card className="type-body p-4 break-words whitespace-pre-line">{order.comment}</Card>
        </Block>
      ) : null}

      {managerUsername ? (
        <p className="type-small mt-6 mb-2 text-center">
          <span className="text-muted">{o.orders.question}</span>{' '}
          <button
            type="button"
            onClick={() => openManagerChat(managerUsername)}
            data-testid="write-manager"
            className="-my-3 rounded-btn px-1 py-3 font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color,opacity] duration-150 hover:decoration-current active:opacity-60"
          >
            {o.orders.writeManager}
          </button>
        </p>
      ) : null}
    </Screen>
  );
}

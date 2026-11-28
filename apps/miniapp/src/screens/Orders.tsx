import type { OrderSummaryDto } from '@lummi/contracts';
import { fill, formatDayMonth, plural } from '@lummi/i18n';
import { useRouter } from '@tanstack/react-router';
import { StatusPill } from '../orders/parts';
import { useOrders, useOrdersText } from '../orders/queries';
import { RepeatLink } from '../orders/repeat';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { BoxIcon, ChevronIcon, GiftIcon } from '../ui/icons';
import { MetaLine } from '../ui/MetaLine';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { Thumb } from '../ui/Thumb';

/** One order: number and status, date and count, the bottles and the total; the whole row opens it. */
function OrderRow({ order, onOpen }: { order: OrderSummaryDto; onOpen: () => void }) {
  const { language } = usePrefs();
  const o = useOrdersText();
  const title = fill(o.orders.number, { number: String(order.number) });
  // a cancelled order stays in the list, quieter: its bottles dimmed, its total in Muted Ink
  const cancelled = order.status === 'cancelled';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="order-row"
      className="flex w-full flex-col gap-2.5 p-4 text-left transition-colors duration-150 hover:bg-field active:bg-field"
    >
      {/* the number never breaks: on a narrow phone a long status drops under it instead */}
      <span className="flex w-full flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <span className="type-row pt-0.5 font-semibold whitespace-nowrap tabular-nums">
          {title}
        </span>
        <StatusPill status={order.status} />
      </span>
      <MetaLine
        className="type-small text-muted"
        parts={[
          formatDayMonth(order.createdAt, language),
          plural(language, order.itemCount, o.orders.items),
          order.isGift ? (
            <span className="inline-flex items-center gap-1 text-ink">
              <GiftIcon size={14} />
              {o.orders.gift}
            </span>
          ) : null,
        ]}
      />
      <span className="flex w-full items-center justify-between gap-3">
        <span className={`flex gap-1.5 ${cancelled ? 'opacity-55' : ''}`} aria-hidden="true">
          {order.photos.map((p, i) => (
            <Thumb key={`${p}-${i}`} photo={p} className="w-9" />
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <Money amount={order.total} className={cancelled ? 'text-muted' : ''} />
          <span className="text-muted">
            <ChevronIcon size={18} />
          </span>
        </span>
      </span>
    </button>
  );
}

function Loading() {
  const o = useOrdersText();
  const row = (
    <div className="space-y-3 p-4">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-28" rounded="pill" />
      </div>
      <Skeleton className="h-3 w-40" />
      <Skeleton className="aspect-[3/4] w-9" rounded="thumb" />
    </div>
  );
  return (
    <Screen>
      <ScreenHeader title={o.orders.title} />
      <Card className="divide-y divide-line overflow-hidden" aria-busy="true">
        {row}
        {row}
      </Card>
    </Screen>
  );
}

/** The «Заказы» tab: every order with its status from the server, whether or not the bot may write. */
export function Orders() {
  const o = useOrdersText();
  const router = useRouter();
  const orders = useOrders();

  if (orders.isError && !orders.data)
    return (
      <Screen>
        <ScreenHeader title={o.orders.title} />
        <ErrorState fill retrying={orders.isFetching} onRetry={() => void orders.refetch()} />
      </Screen>
    );
  if (!orders.data) return <Loading />;
  const all = orders.data.pages.flatMap((p) => p.orders);
  if (all.length === 0)
    return (
      <Screen>
        <ScreenHeader title={o.orders.title} />
        <EmptyState
          fill
          icon={<BoxIcon size={28} />}
          title={o.orders.emptyTitle}
          text={o.orders.emptyText}
          action={
            <Button block onClick={() => void router.navigate({ to: '/catalog' })}>
              {o.orders.toCatalog}
            </Button>
          }
        />
      </Screen>
    );
  return (
    <Screen>
      <ScreenHeader title={o.orders.title} />
      <Card as="ul" className="divide-y divide-line overflow-hidden" data-testid="orders">
        {all.map((order) => (
          <li key={order.number}>
            <OrderRow
              order={order}
              onOpen={() =>
                void router.navigate({
                  to: '/orders/$number',
                  params: { number: String(order.number) },
                })
              }
            />
            {/* a sibling of the row's button, never inside it (mockup 08) */}
            <RepeatLink number={order.number} status={order.status} />
          </li>
        ))}
      </Card>
      {orders.hasNextPage ? (
        <div className="mt-3">
          <Button
            block
            variant="secondary"
            data-testid="orders-more"
            loading={orders.isFetchingNextPage}
            onClick={() => void orders.fetchNextPage()}
          >
            {o.orders.more}
          </Button>
        </div>
      ) : null}
    </Screen>
  );
}

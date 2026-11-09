import type { CartDto, CartLineDto, CartSuggestionDto, Discount } from '@lummi/contracts';
import { fill, formatMoney } from '@lummi/i18n';
import { useIsMutating } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCart, useAddToCart, useRemoveLine, useSetQuantity } from '../cart/queries';
import { photoSrcSet, photoUrl } from '../lib/media';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { BagIcon, CheckIcon, MinusIcon, PlusIcon, TrashIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';

/** A 3:4 bottle thumbnail; the photo slot keeps its own placeholder colour until the image arrives. */
function Thumb({ photo, className = 'w-14' }: { photo: string | null; className?: string }) {
  return (
    <div className={`${className} aspect-[3/4] shrink-0 overflow-hidden rounded-thumb bg-photo`}>
      {photo ? (
        <img
          src={photoUrl(photo, 400)}
          srcSet={photoSrcSet(photo)}
          sizes="64px"
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : null}
    </div>
  );
}

/**
 * The free-delivery Sage thread (DESIGN.md «The Sage Thread»): what is missing as the server worked
 * it out, a thread filled by the threshold base, and up to three 10 ml bottles that would close
 * the gap. Reached, it only says delivery is free.
 */
function Nudge({
  cart,
  busy,
  onAdd,
}: {
  cart: CartDto;
  busy: boolean;
  onAdd: (s: CartSuggestionDto) => void;
}) {
  const { t, language } = usePrefs();
  const { quote } = cart;
  if (quote.itemsSubtotal === 0) return null;
  const reached = quote.amountToFreeDelivery === 0;
  const pct = Math.min(
    100,
    Math.round((quote.thresholdBaseAmount / quote.freeDeliveryThreshold) * 100),
  );
  return (
    <Card className="mb-3 p-4" data-testid="nudge" data-reached={reached}>
      <p className="type-body flex items-start gap-2 text-ink">
        {reached ? (
          <span className="mt-0.5 shrink-0 text-sage-ink">
            <CheckIcon size={18} />
          </span>
        ) : null}
        <span>
          {reached
            ? t.cart.nudgeDone
            : fill(t.cart.nudge, { amount: formatMoney(quote.amountToFreeDelivery, language) })}
        </span>
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-0.5 rounded-[2px] bg-line"
      >
        <div className="h-full rounded-[2px] bg-sage" style={{ width: `${pct}%` }} />
      </div>
      <div className="type-caption mt-1.5 flex justify-between text-muted tabular-nums">
        <span>{formatMoney(quote.thresholdBaseAmount, language)}</span>
        <span>{formatMoney(quote.freeDeliveryThreshold, language)}</span>
      </div>
      {!reached && cart.suggestions.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="type-caption mb-1 text-muted">{t.cart.suggest}</p>
          <ul className="divide-y divide-line">
            {cart.suggestions.map((s) => (
              <li key={s.slug} className="flex items-center gap-3 py-2.5" data-testid="suggestion">
                <Thumb photo={s.photo} className="w-10" />
                <div className="min-w-0 flex-1">
                  <p className="type-name truncate">{s.name}</p>
                  <p className="type-caption text-muted">
                    {s.ml} {t.card.ml} · <Money amount={s.price} size="small" />
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={fill(t.cart.addSuggestion, { name: s.name })}
                  onClick={() => onAdd(s)}
                  className="grid size-8 shrink-0 place-items-center rounded-btn bg-btn text-btn-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] enabled:active:scale-[0.97] disabled:opacity-60"
                >
                  <PlusIcon size={18} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Stepper({
  line,
  busy,
  onQty,
}: {
  line: CartLineDto;
  busy: boolean;
  onQty: (qty: number) => void;
}) {
  const { t } = usePrefs();
  const btn =
    'grid size-8 place-items-center text-ink transition-opacity duration-150 disabled:opacity-35';
  return (
    <div
      role="group"
      aria-label={t.cart.qty}
      className="flex h-8 items-center rounded-btn bg-field"
    >
      <button
        type="button"
        className={btn}
        aria-label={t.cart.decrease}
        disabled={busy || line.qty <= 1}
        onClick={() => onQty(line.qty - 1)}
      >
        <MinusIcon size={16} />
      </button>
      <span className="type-row min-w-6 text-center font-semibold tabular-nums" data-testid="qty">
        {line.qty}
      </span>
      <button
        type="button"
        className={btn}
        aria-label={t.cart.increase}
        disabled={busy || line.qty >= line.available}
        onClick={() => onQty(line.qty + 1)}
      >
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

function Line({
  line,
  cart,
  busy,
  onQty,
  onRemove,
}: {
  line: CartLineDto;
  cart: CartDto;
  busy: boolean;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const { t } = usePrefs();
  const priced = cart.quote.lines.find((l) => l.key === String(line.id));
  return (
    <li className="flex gap-3 p-3" data-testid="cart-line" data-sold-out={line.soldOut}>
      <div className={line.soldOut ? 'opacity-50' : undefined}>
        <Thumb photo={line.photo} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className={`type-name truncate ${line.soldOut ? 'text-muted' : ''}`}>{line.name}</p>
        <p className="type-caption mt-0.5 text-muted">
          {line.ml} {t.card.ml}
          {line.soldOut ? <span className="text-ink"> · {t.cart.soldOut}</span> : null}
        </p>
        {priced && !line.soldOut ? (
          <p className="mt-1 flex items-baseline gap-2">
            <Money amount={priced.unitPrice} />
            {priced.markedDown ? (
              <span className="type-caption text-muted line-through">
                <Money amount={priced.regularUnitPrice} size="small" />
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {line.soldOut ? <span /> : <Stepper line={line} busy={busy} onQty={onQty} />}
          <button
            type="button"
            aria-label={t.cart.remove}
            disabled={busy}
            onClick={onRemove}
            className="grid size-8 place-items-center rounded-btn text-muted transition-colors duration-150 enabled:hover:text-ink disabled:opacity-35"
          >
            <TrashIcon size={18} />
          </button>
        </div>
      </div>
    </li>
  );
}

function discountLabel(d: Discount, t: ReturnType<typeof usePrefs>['t']): string {
  if (d.type === 'promo_code') return fill(t.cart.sourcePromo, { code: d.code });
  if (d.type === 'birthday_coupon') return t.cart.sourceBirthday;
  return d.source === 'set' ? t.cart.sourceSet : t.cart.sourceSingle;
}

/** The dark totals block (approved variant 2): the server's numbers, then «Оформить заказ» inside it. */
function Totals({ cart, onCheckout }: { cart: CartDto; onCheckout: () => void }) {
  const { t } = usePrefs();
  const { quote } = cart;
  const row = 'type-body flex items-baseline justify-between gap-4';
  return (
    <section
      aria-label={t.cart.total}
      data-testid="totals"
      className="mt-3 rounded-card bg-totals p-4 text-totals-ink"
    >
      <div className="flex flex-col gap-2.5">
        <div className={row}>
          <span>{t.cart.items}</span>
          <Money amount={quote.itemsSubtotal} />
        </div>
        {quote.discount ? (
          <div className={`${row} text-sage`} data-testid="discount-row">
            <span>{discountLabel(quote.discount, t)}</span>
            <span className="type-price whitespace-nowrap">
              −<Money amount={quote.discount.amount} className="!font-[inherit]" />
            </span>
          </div>
        ) : null}
        <div className={row}>
          <span>
            {cart.deliveryCity
              ? fill(t.cart.delivery, { city: cart.deliveryCity.city })
              : t.cart.deliveryNoCity}
          </span>
          {quote.deliveryFee === 0 && quote.itemsSubtotal > 0 ? (
            <span className="type-price">{t.cart.deliveryFree}</span>
          ) : (
            <Money amount={quote.deliveryFee} />
          )}
        </div>
      </div>
      <div className="mt-3.5 flex items-baseline justify-between gap-4 border-t border-totals-ink/20 pt-3.5">
        <span className="type-row font-semibold">{t.cart.total}</span>
        <Money amount={quote.total} size="amount" />
      </div>
      <Button
        block
        disabled={quote.itemsSubtotal === 0}
        onClick={onCheckout}
        className="mt-4 !bg-totals-ink !text-totals disabled:!bg-totals-ink/20 disabled:!text-totals-ink/60"
      >
        {t.cart.checkout}
      </Button>
    </section>
  );
}

function Loading() {
  return (
    <Screen>
      <ScreenHeaderTitle />
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-28 w-full" rounded="card" />
        <Skeleton className="h-24 w-full" rounded="card" />
        <Skeleton className="h-24 w-full" rounded="card" />
        <Skeleton className="h-44 w-full" rounded="card" />
      </div>
    </Screen>
  );
}

function ScreenHeaderTitle() {
  const { t } = usePrefs();
  return <ScreenHeader title={t.cart.title} />;
}

/** The cart tab: everything shown comes from the server cart and its Quote. */
export function Cart() {
  const { t } = usePrefs();
  const router = useRouter();
  const cart = useCart();
  const add = useAddToCart();
  const setQty = useSetQuantity();
  const remove = useRemoveLine();
  const busy = useIsMutating() > 0;

  if (cart.isError && !cart.data)
    return (
      <Screen>
        <ScreenHeaderTitle />
        <ErrorState fill retrying={cart.isFetching} onRetry={() => void cart.refetch()} />
      </Screen>
    );
  if (!cart.data) return <Loading />;

  const data = cart.data;
  if (data.lines.length === 0)
    return (
      <Screen>
        <ScreenHeaderTitle />
        <EmptyState
          fill
          icon={<BagIcon size={28} />}
          title={t.cart.emptyTitle}
          text={t.cart.emptyText}
          action={
            <Button block onClick={() => void router.navigate({ to: '/catalog' })}>
              {t.cart.toCatalog}
            </Button>
          }
        />
      </Screen>
    );

  return (
    <Screen>
      <ScreenHeaderTitle />
      <Nudge cart={data} busy={busy} onAdd={(s) => add.mutate({ slug: s.slug, ml: s.ml })} />
      <Card as="ul" className="divide-y divide-line overflow-hidden" data-testid="cart-lines">
        {data.lines.map((line) => (
          <Line
            key={line.id}
            line={line}
            cart={data}
            busy={busy}
            onQty={(qty) => setQty.mutate({ lineId: line.id, qty })}
            onRemove={() => remove.mutate(line.id)}
          />
        ))}
      </Card>
      <Totals cart={data} onCheckout={() => void router.navigate({ to: '/checkout' })} />
    </Screen>
  );
}

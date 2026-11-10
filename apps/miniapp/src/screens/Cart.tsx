import type {
  CartDto,
  CartLineDto,
  CartSuggestionDto,
  Discount,
  QuoteLine,
} from '@lummi/contracts';
import { CART_MAX_QTY } from '@lummi/contracts/constants';
import { fill, formatMoney } from '@lummi/i18n';
import { useIsMutating } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useCart, useAddToCart, useRemoveLine, useSetQuantity } from '../cart/queries';
import { photoSrcSet, photoUrl } from '../lib/media';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { BagIcon, CheckIcon, MinusIcon, PlusIcon, Spinner, TrashIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { SetPhoto, SetPhotoEmpty } from '../ui/SetPhoto';
import { ScreenHeader } from '../ui/ScreenHeader';
import { attribution } from '../ui/FragranceListCard';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';

type T = ReturnType<typeof usePrefs>['t'];

/** What is in flight, so only the control that was tapped shows it. */
export interface CartPending {
  /** The line whose quantity is being set, or which is being removed. */
  line?: number;
  kind?: 'qty' | 'remove';
  /** The suggestion being added. */
  slug?: string;
}

const EASE_OUT = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/** A 3:4 bottle thumbnail on its Photo Blush slot, which stays when the photo is missing or fails. */
function Thumb({
  photo,
  className,
  set,
}: {
  photo: string | null;
  className: string;
  /** A set line: the Discovery box photo (or the owner's), or the box icon for a builder set. */
  set?: 'discovery' | 'builder';
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      aria-hidden="true"
      className={`${className} relative aspect-[3/4] shrink-0 overflow-hidden rounded-thumb bg-photo`}
    >
      {set === 'discovery' ? <SetPhoto hash={photo} sizes="64px" /> : null}
      {set === 'builder' ? <SetPhotoEmpty /> : null}
      {!set && photo && !failed ? (
        <img
          src={photoUrl(photo, 400)}
          srcSet={photoSrcSet(photo)}
          sizes="64px"
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </div>
  );
}

/** How many times a value has changed since mount (0 = never), to replay a small settle on change. */
function useChanges<V>(value: V): number {
  const [seen, setSeen] = useState({ value, n: 0 });
  if (!Object.is(seen.value, value)) setSeen({ value, n: seen.n + 1 });
  return seen.n;
}

/** A server amount that settles in place when it changes, so the totals never jump or flicker. */
function Figure({
  amount,
  minus = false,
  className = '',
}: {
  amount: number;
  minus?: boolean;
  className?: string;
}) {
  const { language } = usePrefs();
  const n = useChanges(amount);
  return (
    <span
      key={n}
      className={`whitespace-nowrap tabular-nums ${n ? 'animate-[tick_0.22s_ease-out]' : ''} ${className}`}
    >
      {minus ? '−' : null}
      {formatMoney(amount, language)}
    </span>
  );
}

/** A message whose one value is set apart, from the i18n template («Добавьте ещё {amount} — …»). */
function withValue(template: string, key: string, value: ReactNode): ReactNode {
  const [before = '', after = ''] = template.split(`{${key}}`);
  return (
    <>
      {before}
      {value}
      {after}
    </>
  );
}

/**
 * The free-delivery Sage thread (DESIGN.md «The Sage Thread», mockup 04-cart): what is missing as
 * the server worked it out, the thread filled to the server's progress, and up to three 10 ml
 * bottles that would close the gap. Reached, it says delivery is free in Sage Ink, and the
 * suggestions fold away instead of vanishing.
 */
function Nudge({
  cart,
  busy,
  pendingSlug,
  onAdd,
}: {
  cart: CartDto;
  busy: boolean;
  pendingSlug?: string;
  onAdd: (s: CartSuggestionDto) => void;
}) {
  const { t, language } = usePrefs();
  const { quote, suggestions } = cart;
  // The last suggestions stay mounted while their block folds away.
  const [kept, setKept] = useState(suggestions);
  if (suggestions.length > 0 && suggestions !== kept) setKept(suggestions);
  if (quote.itemsSubtotal === 0) return null;
  const reached = quote.amountToFreeDelivery === 0;
  const open = !reached && suggestions.length > 0;
  const pct = cart.freeDeliveryProgress;
  return (
    <Card className="mb-3 p-4" data-testid="nudge" data-reached={reached}>
      <p
        className={`type-body flex items-start gap-2 text-pretty ${reached ? 'text-sage-ink' : 'text-ink'}`}
      >
        {reached ? <CheckIcon size={18} className="mt-0.5 shrink-0" /> : null}
        <span>
          {reached
            ? t.cart.nudgeDone
            : withValue(
                t.cart.nudge,
                'amount',
                <span className="font-semibold whitespace-nowrap tabular-nums">
                  {formatMoney(quote.amountToFreeDelivery, language)}
                </span>,
              )}
        </span>
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-0.5 overflow-hidden rounded-[2px] bg-line"
      >
        <div
          className={`h-full origin-left rounded-[2px] bg-sage transition-transform duration-[400ms] ${EASE_OUT}`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
      <div className="type-caption mt-1.5 flex justify-between gap-3 text-muted tabular-nums">
        <span>{formatMoney(quote.thresholdBaseAmount, language)}</span>
        <span>{formatMoney(quote.freeDeliveryThreshold, language)}</span>
      </div>
      <div
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-[260ms] ${EASE_OUT}`}
        style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-4 border-t border-line pt-3">
            <p className="type-small text-muted">{t.cart.suggest}</p>
            <ul className="mt-1 divide-y divide-line">
              {kept.map((s) => {
                const adding = pendingSlug === s.slug;
                return (
                  <li
                    key={s.slug}
                    className="flex items-center gap-3 py-2.5"
                    data-testid="suggestion"
                  >
                    <Thumb photo={s.photo} className="w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="type-label text-pretty text-muted [overflow-wrap:anywhere]">
                        {attribution(t.card.basedOn, s.brand)}
                      </p>
                      <p className="type-name mt-px text-[18px] text-pretty text-ink [overflow-wrap:anywhere]">
                        {s.name}
                      </p>
                      <p className="type-small mt-0.5 text-muted">
                        {s.ml}&nbsp;{t.card.ml} ·{' '}
                        <span className="whitespace-nowrap tabular-nums">
                          {formatMoney(s.price, language)}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={fill(t.cart.addSuggestion, { name: s.name })}
                      aria-disabled={busy || undefined}
                      aria-busy={adding || undefined}
                      onClick={() => {
                        if (!busy) onAdd(s);
                      }}
                      className={`relative grid size-8 shrink-0 place-items-center rounded-btn bg-btn text-btn-ink transition-[transform,opacity] duration-150 ${EASE_OUT} after:absolute after:-inset-1.5 after:content-[''] hover:opacity-90 active:scale-[0.94]`}
                    >
                      {adding ? <Spinner size={16} /> : <PlusIcon size={18} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** One half of the stepper: a 36 x 32 face with a 44 px tall touch area, washed while pressed. */
function StepButton({
  label,
  limit,
  busy,
  onPress,
  children,
}: {
  label: string;
  /** At the end of its range: drawn faint and not pressable. */
  limit: boolean;
  /** Something is in flight: looks the same, ignores the tap. */
  busy: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={limit}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onPress();
      }}
      className={`relative m-px grid h-8 w-9 place-items-center rounded-[9px] text-ink transition-[color,background-color] duration-150 after:absolute after:-inset-y-[6px] after:inset-x-0 after:content-[''] enabled:active:bg-field disabled:cursor-default disabled:text-faint [&>svg]:transition-transform [&>svg]:duration-150 enabled:active:[&>svg]:scale-90`}
    >
      {children}
    </button>
  );
}

/**
 * The quantity stepper: a 34 px hairline-outlined control (DESIGN.md). The number rolls in from the
 * side it came from once the server has set it, and dims while the change is in flight.
 */
function Stepper({
  line,
  busy,
  pending,
  onQty,
}: {
  line: CartLineDto;
  busy: boolean;
  pending: boolean;
  onQty: (qty: number) => void;
}) {
  const { t } = usePrefs();
  const [shown, setShown] = useState({ qty: line.qty, dir: 0 });
  if (shown.qty !== line.qty) setShown({ qty: line.qty, dir: line.qty > shown.qty ? 1 : -1 });
  const roll =
    shown.dir > 0
      ? 'animate-[count-up_0.22s_cubic-bezier(0.23,1,0.32,1)]'
      : shown.dir < 0
        ? 'animate-[count-down_0.22s_cubic-bezier(0.23,1,0.32,1)]'
        : '';
  return (
    <div
      role="group"
      aria-label={t.cart.qty}
      className="inset-line flex h-[34px] shrink-0 items-center rounded-btn"
    >
      <StepButton
        label={t.cart.decrease}
        limit={line.qty <= 1}
        busy={busy}
        onPress={() => onQty(line.qty - 1)}
      >
        <MinusIcon size={16} />
      </StepButton>
      <span
        className="type-row grid h-full min-w-7 place-items-center overflow-hidden font-semibold"
        aria-live="polite"
      >
        <span
          key={shown.qty}
          data-testid="qty"
          className={`tabular-nums transition-opacity duration-150 ${pending ? 'opacity-40' : ''} ${roll}`}
        >
          {line.qty}
        </span>
      </span>
      <StepButton
        label={t.cart.increase}
        limit={line.qty >= Math.min(line.available, CART_MAX_QTY)}
        busy={busy}
        onPress={() => onQty(line.qty + 1)}
      >
        <PlusIcon size={16} />
      </StepButton>
    </div>
  );
}

/**
 * A cart line (DESIGN.md compact row, mockup 04-cart): the thumbnail, the italic name and the
 * volume, the price on the right, then the stepper (or «Нет в наличии» in its place) and the bin.
 * A capped line says «Осталось N» beside the stepper whose «+» it explains.
 */
function Line({
  line,
  priced,
  busy,
  pending,
  onQty,
  onRemove,
}: {
  line: CartLineDto;
  priced: QuoteLine | undefined;
  busy: boolean;
  pending?: 'qty' | 'remove';
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const { t } = usePrefs();
  const out = line.soldOut;
  return (
    <div
      className={`flex gap-3 p-3 transition-opacity duration-200 ${pending === 'remove' ? 'opacity-40' : ''}`}
      data-testid="cart-line"
      data-sold-out={out}
    >
      <div className={out ? 'opacity-50' : undefined}>
        <Thumb
          photo={line.photo}
          className="w-16"
          set={line.kind === 'volume' ? undefined : line.kind}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {line.kind === 'volume' ? (
              <>
                <p className="type-label text-pretty text-muted [overflow-wrap:anywhere]">
                  {attribution(t.card.basedOn, line.brand)}
                </p>
                <p
                  className={`type-name mt-px text-[18px] text-pretty [overflow-wrap:anywhere] ${out ? 'text-muted' : 'text-ink'}`}
                >
                  {line.name}
                </p>
                <p className="type-small mt-1 text-muted">
                  {line.ml}&nbsp;{t.card.ml}
                </p>
              </>
            ) : (
              <>
                <p className="type-label text-pretty text-muted">{t.home.discoveryLabel}</p>
                <p
                  className={`type-name mt-px text-[18px] text-pretty [overflow-wrap:anywhere] ${out ? 'text-muted' : 'text-ink'}`}
                  data-testid="set-name"
                >
                  {line.kind === 'discovery' ? t.sets.lineDiscovery : t.sets.lineBuilder}
                </p>
                <p className="type-small mt-1 text-pretty text-muted [overflow-wrap:anywhere]">
                  {line.fragrances.map((f) => f.name).join(' · ')}
                </p>
              </>
            )}
          </div>
          {priced && !out ? (
            <p className="flex shrink-0 flex-col items-end pt-px">
              <Money
                amount={priced.unitPrice}
                className={priced.markedDown ? 'text-sage-ink' : 'text-ink'}
              />
              {priced.markedDown ? (
                <s className="mt-0.5 text-muted">
                  <Money amount={priced.regularUnitPrice} size="small" />
                </s>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="mt-auto flex items-center gap-2.5 pt-3">
          {out ? (
            <span className="type-caption inline-flex h-7 items-center rounded-pill bg-field px-2.5 font-medium text-muted">
              {t.cart.soldOut}
            </span>
          ) : (
            <Stepper line={line} busy={busy} pending={pending === 'qty'} onQty={onQty} />
          )}
          {line.limited && !out ? (
            <span className="type-caption min-w-0 text-ink" data-testid="only-left">
              {fill(t.cart.onlyLeft, { n: String(line.available) })}
            </span>
          ) : null}
          <button
            type="button"
            aria-label={t.cart.remove}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onRemove();
            }}
            className={`relative -mr-1.5 ml-auto grid size-9 shrink-0 place-items-center rounded-btn text-muted transition-[color,background-color,transform] duration-150 ${EASE_OUT} after:absolute after:-inset-1 after:content-[''] hover:text-ink active:scale-[0.94] active:bg-field active:text-ink`}
          >
            <TrashIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface Row {
  line: CartLineDto;
  priced: QuoteLine | undefined;
  leaving: boolean;
}

const priceOf = (cart: CartDto, line: CartLineDto) =>
  cart.quote.lines.find((l) => l.key === String(line.id));

/**
 * The cart's lines plus, for a moment, the ones the server just dropped, each at its old place,
 * so a removed line folds away instead of vanishing and the totals below never jump.
 */
function useRows(cart: CartDto): Row[] {
  const [state, setState] = useState({
    cart,
    leaving: [] as { row: Row; after: number | null }[],
  });
  if (state.cart !== cart) {
    let after: number | null = null;
    const gone: { row: Row; after: number | null }[] = [];
    for (const line of state.cart.lines) {
      if (cart.lines.some((l) => l.id === line.id)) after = line.id;
      else gone.push({ row: { line, priced: priceOf(state.cart, line), leaving: true }, after });
    }
    setState({ cart, leaving: gone.length ? [...state.leaving, ...gone] : state.leaving });
  }
  useEffect(() => {
    if (state.leaving.length === 0) return;
    const id = setTimeout(() => setState((s) => ({ ...s, leaving: [] })), 260);
    return () => clearTimeout(id);
  }, [state.leaving]);

  const ghostsAfter = (id: number | null) =>
    state.leaving.filter((g) => g.after === id).map((g) => g.row);
  const rows: Row[] = [...ghostsAfter(null)];
  for (const line of cart.lines) {
    rows.push({ line, priced: priceOf(cart, line), leaving: false });
    rows.push(...ghostsAfter(line.id));
  }
  return rows;
}

function discountLabel(d: Discount, t: T): string {
  if (d.type === 'promo_code') return fill(t.cart.sourcePromo, { code: d.code });
  if (d.type === 'birthday_coupon') return t.cart.sourceBirthday;
  return d.source === 'set' ? t.cart.sourceSet : t.cart.sourceSingle;
}

/**
 * The dark totals block (approved variant 2): the server's numbers, a hairline, «Итого», then
 * «Оформить заказ» inside it. Labels sit at 75 % Milk, the values at full Milk; the discount and a
 * free delivery are Dark Sage Ink. When nothing in the cart can be bought, the button says why.
 */
function Totals({ cart, onCheckout }: { cart: CartDto; onCheckout: () => void }) {
  const { t } = usePrefs();
  const { quote } = cart;
  const row = 'flex items-baseline justify-between gap-4';
  const canBuy = quote.itemsSubtotal > 0;
  return (
    <section
      aria-label={t.cart.total}
      data-testid="totals"
      className="rounded-card bg-totals p-4 text-totals-ink"
    >
      <dl className="type-body flex flex-col gap-2.5">
        <div className={row}>
          <dt className="min-w-0 text-totals-ink/75">{t.cart.items}</dt>
          <dd className="type-price">
            <Figure amount={quote.itemsSubtotal} />
          </dd>
        </div>
        {quote.discount ? (
          <div className={`${row} text-totals-accent`} data-testid="discount-row">
            <dt className="flex min-w-0 flex-col">
              <span>{t.cart.discount}</span>
              <span className="type-caption [overflow-wrap:anywhere] opacity-80">
                {discountLabel(quote.discount, t)}
              </span>
            </dt>
            <dd className="type-price">
              <Figure amount={quote.discount.amount} minus />
            </dd>
          </div>
        ) : null}
        <div className={row}>
          <dt className="min-w-0 text-pretty text-totals-ink/75">
            {cart.deliveryCity
              ? fill(t.cart.delivery, { city: cart.deliveryCity.city })
              : t.cart.deliveryNoCity}
          </dt>
          <dd className="type-price">
            {quote.deliveryFee === 0 && canBuy ? (
              <span className="text-totals-accent">{t.cart.deliveryFree}</span>
            ) : (
              <Figure amount={quote.deliveryFee} />
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-3.5 flex items-baseline justify-between gap-4 border-t border-totals-ink/20 pt-3.5">
        <span className="type-total">{t.cart.total}</span>
        <span className="type-total">
          <Figure amount={quote.total} />
        </span>
      </div>
      <Button
        block
        disabled={!canBuy}
        onClick={onCheckout}
        className="mt-4 !bg-totals-ink !text-totals disabled:!bg-totals-ink/15 disabled:!text-totals-ink/70"
      >
        {canBuy ? t.cart.checkout : t.cart.nothingToBuy}
      </Button>
    </section>
  );
}

function ScreenHeaderTitle() {
  const { t } = usePrefs();
  return <ScreenHeader title={t.cart.title} />;
}

/** The cart's own shape while it loads: the thread card, two lines, the totals block. */
function Loading() {
  const line = (
    <div className="flex gap-3 p-3">
      <Skeleton className="aspect-[3/4] w-16" rounded="thumb" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="mt-auto h-[34px] w-[104px]" />
      </div>
    </div>
  );
  return (
    <Screen footer={<Skeleton className="h-[204px] w-full" rounded="card" />}>
      <ScreenHeaderTitle />
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-[92px] w-full" rounded="card" />
        <Card className="divide-y divide-line overflow-hidden">
          {line}
          {line}
        </Card>
      </div>
    </Screen>
  );
}

/** What the cart screen shows for one server cart; the dev fixtures render it too. */
export function CartView({
  cart: data,
  busy = false,
  pending = {},
  onAdd = () => undefined,
  onQty = () => undefined,
  onRemove = () => undefined,
  onCheckout = () => undefined,
}: {
  cart: CartDto;
  busy?: boolean;
  pending?: CartPending;
  onAdd?: (s: CartSuggestionDto) => void;
  onQty?: (lineId: number, qty: number) => void;
  onRemove?: (lineId: number) => void;
  onCheckout?: () => void;
}) {
  const rows = useRows(data);
  return (
    <Screen footer={<Totals cart={data} onCheckout={onCheckout} />}>
      <ScreenHeaderTitle />
      <Nudge cart={data} busy={busy} pendingSlug={pending.slug} onAdd={onAdd} />
      <Card as="ul" className="divide-y divide-line overflow-hidden" data-testid="cart-lines">
        {rows.map(({ line, priced, leaving }) =>
          leaving ? (
            <li
              key={line.id}
              aria-hidden="true"
              inert
              className="grid animate-[fold_0.24s_cubic-bezier(0.23,1,0.32,1)_forwards]"
            >
              <div className="min-h-0 overflow-hidden">
                <Line line={line} priced={priced} busy onQty={noop} onRemove={noop} />
              </div>
            </li>
          ) : (
            <li key={line.id}>
              <Line
                line={line}
                priced={priced}
                busy={busy}
                pending={pending.line === line.id ? pending.kind : undefined}
                onQty={(qty) => onQty(line.id, qty)}
                onRemove={() => onRemove(line.id)}
              />
            </li>
          ),
        )}
      </Card>
    </Screen>
  );
}

const noop = () => undefined;

/** The cart tab: everything shown comes from the server cart and its Quote. */
export function Cart() {
  const { t } = usePrefs();
  const router = useRouter();
  const cart = useCart({ fresh: true });
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

  const pending: CartPending = setQty.isPending
    ? { line: setQty.variables?.lineId, kind: 'qty' }
    : remove.isPending
      ? { line: remove.variables, kind: 'remove' }
      : add.isPending
        ? { slug: add.variables?.slug }
        : {};

  return (
    <CartView
      cart={data}
      busy={busy}
      pending={pending}
      onAdd={(s) => add.mutate({ slug: s.slug, ml: s.ml })}
      onQty={(lineId, qty) => setQty.mutate({ lineId, qty })}
      onRemove={(lineId) => remove.mutate(lineId)}
      onCheckout={() => void router.navigate({ to: '/checkout' })}
    />
  );
}

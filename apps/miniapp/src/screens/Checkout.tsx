import type { CheckoutDto, CreateOrderBody, Discount } from '@lummi/contracts';
import {
  ORDER_COMMENT_MAX,
  RECIPIENT_NAME_MAX,
  RECIPIENT_PHONE_INPUT_MAX,
  normalizeRecipientPhone,
} from '@lummi/contracts/constants';
import { fill, formatPhone } from '@lummi/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { promoReasonText } from '../cart/promo';
import { ChosenPoint } from '../delivery/ChosenPoint';
import { DeliveryPicker } from '../delivery/DeliveryPicker';
import { deliveryPlace, regionName, useCities, type Picked } from '../delivery/queries';
import { MoneySummary, SectionTitle } from '../orders/parts';
import { checkoutKey, useCheckout, useCreateOrder, useOrdersText } from '../orders/queries';
import { usePrefs } from '../lib/prefs';
import { useRegistration } from '../lib/registration';
import { hapticSuccess } from '../lib/telegram';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Checkbox, FieldError, TextArea, TextField } from '../ui/Field';
import { Figure } from '../ui/Figure';
import {
  AlertIcon,
  BagIcon,
  CheckIcon,
  ChevronIcon,
  GiftIcon,
  PhoneIcon,
  TagIcon,
  TruckIcon,
} from '../ui/icons';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';

type Destination = Exclude<Picked, { kind: 'city' }>;

interface Conflict {
  code: 'total_changed' | 'nothing_to_order';
  /** The total the shopper had confirmed. */
  was: number;
  checkout: CheckoutDto;
}

/** «Пункт BTS» with «Сменить» over a plate: the shape of `ChosenPoint`, for a typed address. */
function TypedPlace({
  region,
  text,
  onChange,
}: {
  region: string;
  text: string;
  onChange: () => void;
}) {
  const { t } = usePrefs();
  const o = useOrdersText();
  return (
    <div data-testid="typed-point">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="type-small font-medium text-muted">{t.delivery.pointTitle}</span>
        <button
          type="button"
          onClick={onChange}
          className="type-small -my-3 -mr-2 rounded-btn px-2 py-3 font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current"
        >
          {t.delivery.change}
        </button>
      </div>
      <div className="rounded-btn bg-card px-3.5 py-3 shadow-[inset_0_0_0_1.5px_var(--c-ink)]">
        <p className="type-row font-semibold break-words">{region}</p>
        <p className="type-body break-words whitespace-pre-line">{text}</p>
        <p className="type-small mt-1 text-muted">
          {o.checkout.typedTitle}. {o.checkout.typedNote}
        </p>
      </div>
    </div>
  );
}

/**
 * «Пункт BTS» before one is chosen: a field-like row (Milk Field, never the chosen point's white
 * plate) that opens the picker. Left empty on submit it leads with the alert icon and says why.
 */
function ChoosePoint({ onOpen, error }: { onOpen: () => void; error: string | null }) {
  const { t } = usePrefs();
  const o = useOrdersText();
  return (
    <div>
      <span className="type-small mb-1.5 block font-medium text-muted">
        {t.delivery.pointTitle}
      </span>
      <button
        type="button"
        data-testid="choose-point"
        data-invalid={error ? true : undefined}
        aria-describedby={error ? 'choose-point-error' : undefined}
        onClick={onOpen}
        className={`type-row flex h-12 w-full items-center gap-2.5 rounded-btn bg-field px-3.5 text-left text-ink transition-[background-color,transform] duration-150 active:scale-[0.99] ${error ? 'shadow-[inset_0_0_0_1px_var(--c-ink)]' : ''}`}
      >
        {error ? (
          <span aria-hidden="true" className="shrink-0">
            <AlertIcon size={18} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{o.checkout.choosePoint}</span>
        <span className="shrink-0 text-muted">
          <ChevronIcon size={18} />
        </span>
      </button>
      {error ? <FieldError id="choose-point-error">{error}</FieldError> : null}
    </div>
  );
}

/** «Далее» on the keyboard moves to the next field the shopper can type in (the account phone is read-only). */
function toNextField(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const fields = [
    ...document.querySelectorAll<HTMLElement>('main input:not([readonly]), main textarea'),
  ];
  fields[fields.indexOf(e.currentTarget) + 1]?.focus();
}

/** A fresh idempotency key for one checkout attempt (the API keeps one order per key). */
function newAttemptKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // older WebViews: a v4 UUID from the same random source
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function Loading() {
  const o = useOrdersText();
  const field = (
    <div className="space-y-1.5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-12 w-full" rounded="btn" />
    </div>
  );
  return (
    <Screen tabBar={false} dock={<Skeleton className="h-12 w-full" rounded="btn" />}>
      <ScreenHeader title={o.checkout.title} />
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-3.5 w-28" />
        {field}
        {field}
        {field}
        <Skeleton className="mt-3 h-[92px] w-full" rounded="card" />
      </div>
    </Screen>
  );
}

/** Mockup 06, restyled to the approved chrome: recipient, BTS point, comment, gift, the server's total. */
export function Checkout() {
  const o = useOrdersText();
  const { t, language } = usePrefs();
  const router = useRouter();
  const qc = useQueryClient();
  const { ensurePhone } = useRegistration();

  const [dest, setDest] = useState<Destination | null>(null);
  const regionId = dest?.region.id;
  const checkout = useCheckout(regionId);
  const create = useCreateOrder();
  const cities = useCities(dest?.kind === 'point' ? dest.region.id : undefined);

  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneBlurred, setPhoneBlurred] = useState(false);
  const [comment, setComment] = useState('');
  const [gift, setGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [phoneRefused, setPhoneRefused] = useState(false);
  const attemptKey = useRef<string | null>(null);

  const data = checkout.data;
  const noPhone = !!data && data.phone === null;

  // Checkout needs the account phone (ADR 0004): the registration step opens once on arrival.
  const askedPhone = useRef(false);
  const askPhone = async () => {
    if ((await ensurePhone()) === 'ready') await qc.invalidateQueries({ queryKey: ['checkout'] });
  };
  useEffect(() => {
    if (!noPhone || askedPhone.current) return;
    askedPhone.current = true;
    void askPhone();
    // once per arrival: `askPhone` is recreated each render, the flag keeps it to one call
  }, [noPhone]);

  if (checkout.isError && !data)
    return (
      <Screen tabBar={false}>
        <ScreenHeader title={o.checkout.title} />
        <ErrorState fill retrying={checkout.isFetching} onRetry={() => void checkout.refetch()} />
      </Screen>
    );
  if (!data) return <Loading />;

  const toCart = () => void router.navigate({ to: '/cart' });

  if (noPhone)
    return (
      <Screen tabBar={false}>
        <ScreenHeader title={o.checkout.title} />
        <EmptyState
          fill
          icon={<PhoneIcon size={28} />}
          title={o.checkout.phoneTitle}
          text={o.checkout.phoneText}
          action={
            <>
              <Button block onClick={() => void askPhone()}>
                {o.checkout.phoneShare}
              </Button>
              <Button block variant="secondary" onClick={toCart}>
                {o.checkout.backToCart}
              </Button>
            </>
          }
        />
      </Screen>
    );

  // Everything sold out while the shopper was on the screen (409 nothing_to_order): its quote
  // lands here with nothing left, so this state says what happened, not just that it is empty.
  const soldOutMeanwhile = conflict?.code === 'nothing_to_order';
  if (data.itemCount === 0)
    return (
      <Screen tabBar={false}>
        <ScreenHeader title={o.checkout.title} />
        <EmptyState
          fill
          icon={<BagIcon size={28} />}
          title={soldOutMeanwhile ? o.checkout.goneTitle : o.checkout.emptyTitle}
          text={soldOutMeanwhile ? o.checkout.goneText : o.checkout.emptyText}
          action={
            <Button block onClick={toCart}>
              {o.checkout.toCart}
            </Button>
          }
        />
      </Screen>
    );

  const codes = data.recipientPhoneCountryCodes;
  // The account phone is the default Recipient only when it is from an allowed country.
  const accountPhoneFits =
    data.phone !== null && normalizeRecipientPhone(data.phone, codes) !== null;
  const nameValue = name ?? data.recipientName;
  const phoneValue = phone ?? (accountPhoneFits && data.phone ? formatPhone(data.phone) : '');
  const phoneOk = !phoneRefused && normalizeRecipientPhone(phoneValue, codes) !== null;
  const codesText = codes.map((c) => `+${c}`).join(', ');
  const onlyUzbekistan = codes.length === 1 && codes[0] === '998';
  const giftTooLong = gift && giftMessage.trim().length > data.giftMessageMax;

  // Field errors show once the field was left or a submit was tried (and a server refusal).
  const errors = {
    point: attempted && !dest ? o.checkout.needPoint : null,
    name: attempted && !nameValue.trim() ? o.checkout.needName : null,
    phone:
      (attempted || phoneBlurred) && !phoneOk
        ? phoneValue.trim() === ''
          ? onlyUzbekistan
            ? o.checkout.phoneInUzbekistan
            : fill(o.checkout.phoneWithCodes, { codes: codesText })
          : onlyUzbekistan
            ? o.checkout.phoneInvalid
            : fill(o.checkout.phoneNotAllowed, { codes: codesText })
        : null,
    consent: attempted && data.needsConsent && !consent ? o.checkout.needConsent : null,
    gift: giftTooLong ? fill(o.checkout.giftTooLong, { max: String(data.giftMessageMax) }) : null,
  };
  const invalid =
    !dest || !nameValue.trim() || !phoneOk || (data.needsConsent && !consent) || giftTooLong;

  const place =
    dest?.kind === 'point'
      ? deliveryPlace(dest.region, dest.point.city, language)
      : dest?.kind === 'typed'
        ? regionName(dest.region, language)
        : data.deliveryCity
          ? deliveryPlace(data.deliveryCity.region, data.deliveryCity.city, language)
          : null;
  const inCity =
    dest?.kind === 'point'
      ? (cities.data?.find((c) => c.city === dest.point.city)?.pointCount ?? 0)
      : 0;

  /** The total and the discount the shopper sees are what they confirm (the server re-checks both). */
  const submit = (confirmedTotal: number, confirmedDiscount: Discount | null) => {
    if (!dest || invalid) {
      // show every field's error, then focus the first one and bring it to the middle of the screen
      setAttempted(true);
      setError(o.checkout.fixErrors);
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(
          'main [aria-invalid="true"], main [data-invalid]',
        );
        if (!first) return;
        // focus first, without its own jump: a keyboard that opens then shrinks the viewport, and
        // the dock lifts the field above itself; the scroll centres it either way
        first.focus({ preventScroll: true });
        // the consent box is a visually hidden input: centre its row, not the 1 px input
        (first.closest('label') ?? first).scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    setError(null);
    // one key per attempt, kept until an order comes back: a repeat returns that order (no second one)
    attemptKey.current ??= newAttemptKey();
    const body: CreateOrderBody = {
      recipientName: nameValue.trim(),
      recipientPhone: phoneValue,
      delivery:
        dest.kind === 'point'
          ? { kind: 'point', pointId: dest.point.id }
          : { kind: 'typed', regionId: dest.region.id, text: dest.text },
      comment: comment.trim() || undefined,
      gift,
      giftMessage: gift && giftMessage.trim() ? giftMessage.trim() : undefined,
      consent,
      confirmedTotal,
      confirmedDiscount,
      idempotencyKey: attemptKey.current,
    };
    create.mutate(body, {
      onSuccess: (r) => {
        if (r.kind === 'created') {
          setConflict(null);
          attemptKey.current = null;
          hapticSuccess();
          void router.navigate({
            to: '/orders/$number',
            params: { number: String(r.order.number) },
            replace: true,
          });
        } else if (r.kind === 'conflict') {
          // the new numbers replace the old ones on the screen too
          qc.setQueryData(checkoutKey(regionId), r.checkout);
          setConflict({ code: r.code, was: confirmedTotal, checkout: r.checkout });
        } else if (r.kind === 'try_again') {
          setConflict(null);
          setError(o.checkout.tryAgain);
        } else if (r.kind === 'phone_required') {
          void askPhone();
        } else {
          setConflict(null);
          setAttempted(true);
          if (r.code === 'unknown_point' || r.code === 'unknown_region') {
            setDest(null);
            setError(o.checkout.unknownPoint);
          } else if (r.code === 'gift_message_too_long') {
            setError(fill(o.checkout.giftTooLong, { max: String(data.giftMessageMax) }));
          } else {
            // the allowed countries or the consent changed meanwhile: re-read what checkout asks
            if (r.code === 'invalid_recipient_phone') setPhoneRefused(true);
            void qc.invalidateQueries({ queryKey: ['checkout'] });
            setError(o.checkout.fixErrors);
          }
        }
      },
      onError: () => setError(o.checkout.failed),
    });
  };

  const total = data.quote.total;
  const dock = (
    <div className="flex flex-col gap-2">
      {error ? (
        // a new message settles up into place, so the dock growing under the thumb reads as news
        <p
          key={error}
          role="alert"
          className="type-small flex animate-[rise-in_0.22s_cubic-bezier(0.23,1,0.32,1)] items-start gap-2 rounded-btn bg-field px-3 py-2.5 text-ink"
        >
          <span className="shrink-0">
            <AlertIcon size={18} />
          </span>
          <span className="pt-px">{error}</span>
        </p>
      ) : null}
      <Button
        block
        data-testid="submit"
        // while another region is being quoted, the total on the button is the last one: wait for it
        loading={(create.isPending && !conflict) || checkout.isPlaceholderData}
        onClick={() => submit(total, data.quote.discount)}
      >
        <span className="min-w-0 truncate">{o.checkout.submit}</span>
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-current opacity-35" />
        <Figure amount={total} />
      </Button>
    </div>
  );

  return (
    <Screen tabBar={false} dock={dock}>
      <ScreenHeader title={o.checkout.title} />

      <section className="flex flex-col gap-3.5">
        <SectionTitle flush>{o.checkout.recipient}</SectionTitle>
        <TextField
          label={o.checkout.name}
          value={nameValue}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          onKeyDown={toNextField}
          maxLength={RECIPIENT_NAME_MAX}
          error={errors.name}
        />
        {data.phone ? (
          <TextField
            label={o.checkout.accountPhone}
            value={formatPhone(data.phone)}
            readOnly
            tabIndex={-1}
            className="!bg-transparent tabular-nums inset-line"
            trailing={
              <span className="type-small flex items-center gap-1 font-semibold text-sage-ink">
                <CheckIcon size={14} />
                {o.checkout.fromTelegram}
              </span>
            }
          />
        ) : null}
        <TextField
          label={o.checkout.recipientPhone}
          value={phoneValue}
          onChange={(e) => {
            setPhone(e.target.value);
            setPhoneRefused(false);
          }}
          onBlur={() => setPhoneBlurred(true)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoCorrect="off"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          maxLength={RECIPIENT_PHONE_INPUT_MAX}
          className="tabular-nums"
          // a mask, not a demo number that could pass for a real one
          placeholder={onlyUzbekistan ? '+998 __ ___ __ __' : undefined}
          hint={
            accountPhoneFits
              ? o.checkout.recipientPhoneHint
              : onlyUzbekistan
                ? o.checkout.phoneInUzbekistan
                : fill(o.checkout.phoneWithCodes, { codes: codesText })
          }
          error={errors.phone}
        />
      </section>

      <section className="mt-[26px] flex flex-col gap-3.5">
        <SectionTitle flush>{o.checkout.delivery}</SectionTitle>
        <Card className="type-body flex items-start gap-3 p-4">
          <span className="mt-0.5 shrink-0 text-ink">
            <TruckIcon size={20} />
          </span>
          <span className="text-pretty">
            <b className="font-semibold">{o.checkout.deliveryLead}</b> {o.checkout.deliveryInfo}
          </span>
        </Card>
        {dest?.kind === 'point' ? (
          <ChosenPoint
            point={dest.point}
            otherPoints={Math.max(0, inCity - 1)}
            onChange={() => setPickerOpen(true)}
          />
        ) : dest?.kind === 'typed' ? (
          <TypedPlace
            region={regionName(dest.region, language)}
            text={dest.text}
            onChange={() => setPickerOpen(true)}
          />
        ) : (
          <ChoosePoint onOpen={() => setPickerOpen(true)} error={errors.point} />
        )}
      </section>

      <section className="mt-[26px]">
        <TextArea
          label={o.checkout.comment}
          aside={o.checkout.optional}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={o.checkout.commentPlaceholder}
          maxLength={ORDER_COMMENT_MAX}
          rows={2}
        />
      </section>

      <section className="mt-[26px]">
        <Card className="p-4" data-testid="gift">
          <Checkbox checked={gift} onChange={setGift} testId="gift-toggle">
            <span className="flex items-center gap-2 font-semibold">
              <GiftIcon size={18} />
              {o.checkout.gift}
            </span>
            <span className="type-small mt-0.5 block text-muted">{o.checkout.giftText}</span>
          </Checkbox>
          <Reveal open={gift}>
            <div className="pt-3.5">
              <TextArea
                label={o.checkout.giftMessage}
                aside={o.checkout.optional}
                value={giftMessage}
                onChange={(e) => setGiftMessage(e.target.value)}
                placeholder={o.checkout.giftMessagePlaceholder}
                maxLength={data.giftMessageMax}
                rows={3}
                error={errors.gift}
                hint={
                  // at the limit the count steps up to ink: the card can take no more
                  <span
                    className={`block text-right tabular-nums ${
                      giftMessage.trim().length >= data.giftMessageMax ? 'font-medium text-ink' : ''
                    }`}
                  >
                    {fill(o.checkout.giftMessageCount, {
                      n: String(giftMessage.trim().length),
                      max: String(data.giftMessageMax),
                    })}
                  </span>
                }
              />
            </div>
          </Reveal>
        </Card>
      </section>

      <section className="mt-[26px]">
        <SectionTitle>{o.checkout.summary}</SectionTitle>
        <MoneySummary
          itemCount={data.itemCount}
          itemsSubtotal={data.quote.itemsSubtotal}
          discount={data.quote.discount}
          deliveryFee={data.quote.deliveryFee}
          total={data.quote.total}
          place={place}
        />
      </section>

      {data.needsConsent ? (
        <section className="mt-5" data-testid="consent">
          <Checkbox checked={consent} onChange={setConsent} invalid={!!errors.consent}>
            {o.checkout.consent}
          </Checkbox>
          {errors.consent ? <FieldError inset>{errors.consent}</FieldError> : null}
        </section>
      ) : null}
      <div className="h-6" />

      <Sheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t.delivery.pointTitle}
        description={t.delivery.pointText}
        closeLabel={t.common.close}
        tall
      >
        <DeliveryPicker
          mode="point"
          initial={
            dest?.kind === 'point'
              ? { regionId: dest.region.id, city: dest.point.city }
              : data.deliveryCity
                ? { regionId: data.deliveryCity.region.id, city: data.deliveryCity.city }
                : null
          }
          selectedPointId={dest?.kind === 'point' ? dest.point.id : undefined}
          onPick={(p) => {
            if (p.kind === 'city') return;
            setDest(p);
            setError(null);
            setPickerOpen(false);
          }}
        />
      </Sheet>

      <ConflictSheet
        conflict={conflict}
        busy={create.isPending}
        place={place}
        onConfirm={(quote) => submit(quote.total, quote.discount)}
        onCart={toCart}
        onClose={() => setConflict(null)}
      />
    </Screen>
  );
}

/** Folds content open and shut without a jump (the cart's suggestion fold). */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={!open}
      className="grid transition-[grid-template-rows,opacity] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
      style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
    >
      {/* 4 px of room each side, so a focused field's Sage ring is not clipped by the fold */}
      <div className="-mx-1 min-h-0 overflow-hidden px-1 pb-1">{children}</div>
    </div>
  );
}

/**
 * The total changed while the shopper was checking out (ADR 0001): they see the old total struck,
 * the new one and its breakdown, and confirm it, because they will transfer exactly that. When
 * nothing is left to order, the only way on is back to the cart.
 */
function ConflictSheet({
  conflict,
  busy,
  place,
  onConfirm,
  onCart,
  onClose,
}: {
  conflict: Conflict | null;
  busy: boolean;
  place: string | null;
  onConfirm: (quote: CheckoutDto['quote']) => void;
  onCart: () => void;
  onClose: () => void;
}) {
  const { t, language } = usePrefs();
  const o = useOrdersText();
  // keep the last conflict on screen while the sheet slides away
  const [shown, setShown] = useState(conflict);
  if (conflict && conflict !== shown) setShown(conflict);
  const c = conflict ?? shown;
  const gone = c?.code === 'nothing_to_order';
  const promo = c?.checkout.quote.promoCode;
  // a lost discount can leave the total as it was (free delivery offsets it): say what changed
  const sameTotal = !!c && !gone && c.checkout.quote.total === c.was;
  return (
    <Sheet
      open={!!conflict}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        gone
          ? o.checkout.goneTitle
          : sameTotal
            ? o.checkout.discountChangedTitle
            : o.checkout.changedTitle
      }
      description={
        gone
          ? o.checkout.goneText
          : sameTotal
            ? o.checkout.discountChangedText
            : o.checkout.changedText
      }
      closeLabel={t.common.close}
    >
      {c && !gone ? (
        <div className="flex flex-col pb-1" data-testid="total-changed">
          <MoneySummary
            itemCount={c.checkout.itemCount}
            itemsSubtotal={c.checkout.quote.itemsSubtotal}
            discount={c.checkout.quote.discount}
            deliveryFee={c.checkout.quote.deliveryFee}
            total={c.checkout.quote.total}
            place={place}
            was={c.was}
          />
          {promo?.invalid ? (
            // the code the shopper confirmed with no longer applies: say which and why (#29)
            <p
              className="type-small mt-3 flex items-start gap-2 text-pretty text-ink"
              data-testid="changed-promo"
            >
              <span aria-hidden="true" className="flex h-[18px] shrink-0 items-center text-muted">
                <TagIcon size={16} />
              </span>
              <span className="min-w-0">
                <span className="font-semibold tracking-[0.04em] [overflow-wrap:anywhere]">
                  {promo.code}
                </span>
                <span className="block">{promoReasonText(promo.invalid, t, language)}</span>
              </span>
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-2">
            <Button block loading={busy} onClick={() => onConfirm(c.checkout.quote)}>
              <span className="min-w-0 truncate">{o.checkout.changedConfirm}</span>
              <span aria-hidden="true" className="h-4 w-px shrink-0 bg-current opacity-35" />
              <Money amount={c.checkout.quote.total} className="text-current" />
            </Button>
            <Button block variant="secondary" onClick={onCart}>
              {o.checkout.backToCart}
            </Button>
          </div>
        </div>
      ) : (
        <div className="pb-1">
          <Button block onClick={onCart}>
            {o.checkout.backToCart}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

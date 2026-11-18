import {
  promoGiftOf,
  type CartDto,
  type CartLineDto,
  type Discount,
  type DiscountChoiceDto,
  type DiscountOptionDto,
  type UpgradeRightSource,
} from '@lummi/contracts';
import { fill, formatCalendarDate, formatMoney } from '@lummi/i18n';
import { Fragment, type ReactNode } from 'react';
import type { Lapsed, LapsedDiscount } from '../../cart/stale-choice';
import { useDiscountsText } from '../../discounts/queries';
import { usePrefs } from '../../lib/prefs';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { CodeText } from '../../ui/DiscountRow';
import { AlertIcon, Spinner } from '../../ui/icons';

/** What the switch sends for a row: its entitlement, the entered code, or «Не применять». */
export function choiceOf(d: Discount | null): DiscountChoiceDto {
  if (d === null) return { type: 'none' };
  if (d.type === 'promo_code') return { type: 'promo_code' };
  return { type: d.type, id: d.id };
}

/** One key per choice, for the row in flight. */
export const choiceKey = (c: DiscountChoiceDto) => ('id' in c ? `${c.type}:${c.id}` : c.type);

/** A tapped discount the server refused (409), as the lapsed-discount notice names it. */
export function lapsedOf(d: Discount | null): LapsedDiscount | null {
  if (d === null) return null;
  if (d.type === 'promo_code') return { type: d.type, code: d.code };
  return d.type === 'upgrade_right' ? { type: d.type, source: d.source } : { type: d.type };
}

/**
 * An entitlement's source, as the switch's messages are keyed (a row, the hint, the lapsed notice):
 * an upgrade right by where it came from, a set or a 10 ml bottle.
 */
type Source = UpgradeRightSource | 'birthday_coupon';
const sourceOf = (
  e: { type: 'birthday_coupon' } | { type: 'upgrade_right'; source: UpgradeRightSource },
): Source => (e.type === 'upgrade_right' ? e.source : e.type);

const EASE_OUT = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/** «Tygar 30 мл»: the bottle an upgrade right discounts, the cart line its `lineKey` names. */
function bottleOf(d: Discount | null, lines: CartLineDto[], template: string): string | null {
  if (d?.type !== 'upgrade_right') return null;
  const line = lines.find((l) => String(l.id) === d.lineKey);
  return line?.kind === 'volume' ? fill(template, { name: line.name, ml: String(line.ml) }) : null;
}

/** Parts of a muted detail line, joined with « · ». */
function Joined({ parts }: { parts: ReactNode[] }) {
  return parts.map((p, i) => (
    <Fragment key={i}>
      {i > 0 ? ' · ' : null}
      {p}
    </Fragment>
  ));
}

/**
 * The cart's discount switch (#39, ADR 0002; mockup 10-cart-discount, restyled to the approved
 * chrome): «СКИДКА» and the one-discount rule; with an entered code and a cheaper entitlement, the
 * Sage note «Скидка за набор выгоднее на … сум» with «Переключить»; then every choice as a radio
 * row with its total, in the server's order (cheapest first, «Не применять» last), so a row stays
 * put when tapped. Every amount shown is the server's: the Mini App adds nothing up. Where the
 * choices differ in delivery, a row that pays it says «+ доставка …» (its own quote's fee), so a
 * bigger discount with a higher total reads right. A chosen discount that lapsed (or a tap the
 * server refused) says which and what applies now, at the top, alone when nothing is left to choose.
 */
export function DiscountChoice({
  cart,
  lapsed,
  busy,
  pending,
  onChoose,
}: {
  cart: CartDto;
  /** The shopper's discount stopped applying, or their tap was refused (#39). */
  lapsed: Lapsed | null;
  busy: boolean;
  /** The key (`choiceKey`) of the choice in flight. */
  pending?: string;
  onChoose: (c: DiscountChoiceDto) => void;
}) {
  const { t, language } = usePrefs();
  const d = useDiscountsText();
  const c = d.choice;
  const options = cart.discountOptions;
  const until = (lastDay: string) => fill(d.until, { date: formatCalendarDate(lastDay, language) });
  const notice = lapsed ? (
    <p
      className="type-small flex items-start gap-1.5 rounded-btn bg-sage-wash py-2.5 pr-3 pl-3 text-pretty text-ink shadow-[inset_0_0_0_1px_var(--c-sage)]"
      data-testid="choice-stale"
      role="status"
    >
      <span aria-hidden="true" className="flex h-[18px] shrink-0 items-center text-sage-ink">
        <AlertIcon size={14} />
      </span>
      <span className="min-w-0">
        {fill(c.lapsed.text, {
          what: lapsedName(lapsed.what, c.lapsed.what),
          now: appliedNow(cart.quote.discount, c.lapsed.now),
        })}
      </span>
    </p>
  ) : null;
  if (options.length === 0) return notice ? <div className="mt-3">{notice}</div> : null;

  const keeps = options.some((o) => o.terms !== null);
  // the choices differ in delivery: the ones that pay it say so
  const someFree = options.some((o) => o.deliveryFee === 0);
  const label = (o: DiscountOptionDto): ReactNode => {
    const x = o.discount;
    if (x === null) return c.none;
    if (x.type === 'promo_code') {
      const [before = '', after = ''] = t.cart.sourcePromo.split('{code}');
      return (
        <>
          {before}
          <CodeText code={x.code} />
          {after}
        </>
      );
    }
    const percent = String(o.terms?.percent ?? (x.type === 'upgrade_right' ? x.percent : ''));
    return fill(c.option[sourceOf(x)], { percent });
  };
  const detail = (o: DiscountOptionDto): ReactNode[] => {
    if (o.discount === null) return keeps ? [c.noneKeeps] : [];
    const bottle = bottleOf(o.discount, cart.lines, c.bottle);
    return [
      <span key="amount" className="whitespace-nowrap text-sage-ink tabular-nums">
        {promoGiftOf(o.discount)
          ? t.cart.promoGift
          : `−${formatMoney(o.discount.amount, language)}`}
      </span>,
      bottle,
      o.terms ? <span className="whitespace-nowrap">{until(o.terms.lastDay)}</span> : null,
    ].filter((p) => p);
  };

  // ADR 0002: the entered code wins; the cheaper entitlement says by how much, one tap away
  const waiting = cart.entitlementWaiting;
  const better = waiting && waiting.cheaperBy > 0 ? waiting : null;
  const betterOption = better
    ? options.find((o) => o.discount?.type === better.type && o.discount.id === better.id)
    : undefined;
  const betterBottle = bottleOf(betterOption?.discount ?? null, cart.lines, c.bottle);

  return (
    <Card
      as="section"
      className="mt-3 overflow-hidden"
      aria-labelledby="choice-title"
      data-testid="discount-choice"
    >
      <div className="px-4 pt-4">
        <h2 id="choice-title" className="type-section text-ink">
          {c.title}
        </h2>
        <p className="type-small mt-1 text-pretty text-muted">{c.hint}</p>
        {notice ? <div className="mt-2.5">{notice}</div> : null}
        {better ? (
          // below ~380 px «Переключить» goes under the text, so the headline keeps one line
          <div
            className="mt-3 flex items-center gap-3 rounded-btn bg-sage-wash py-2.5 pr-2.5 pl-3 shadow-[inset_0_0_0_1px_var(--c-sage)] max-[379px]:flex-col max-[379px]:items-start max-[379px]:gap-2 max-[379px]:pr-3"
            data-testid="choice-better"
          >
            <p className="min-w-0 flex-1 text-pretty max-[379px]:flex-none">
              <span
                className="type-small block font-semibold text-sage-ink"
                data-testid="better-text"
              >
                {fill(c.better[sourceOf(better)], {
                  amount: formatMoney(better.cheaperBy, language),
                })}
              </span>
              <span className="type-caption mt-0.5 block text-muted" data-testid="better-detail">
                <Joined
                  parts={[
                    ...(betterBottle ? [betterBottle] : []),
                    <span className="whitespace-nowrap">{until(better.lastDay)}</span>,
                  ]}
                />
              </span>
            </p>
            <Button
              variant="secondary"
              size="sm"
              aria-disabled={busy || undefined}
              loading={pending === choiceKey({ type: better.type, id: better.id })}
              onClick={() => {
                if (!busy) onChoose({ type: better.type, id: better.id });
              }}
              className="shrink-0"
            >
              {c.switchTo}
            </Button>
          </div>
        ) : null}
        <p className="type-caption mt-3 text-right text-muted" aria-hidden="true">
          {c.total}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="choice-title"
        className="mt-1 divide-y divide-line border-t border-line"
      >
        {options.map((o) => {
          const choice = choiceOf(o.discount);
          const key = choiceKey(choice);
          const inFlight = pending === key;
          const parts = detail(o);
          // its own line, so the amount and the date stay together above it
          const delivery =
            someFree && o.deliveryFee > 0
              ? fill(c.plusDelivery, { amount: formatMoney(o.deliveryFee, language) })
              : null;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={o.applied}
              aria-disabled={busy || undefined}
              aria-busy={inFlight || undefined}
              data-testid="discount-option"
              onClick={() => {
                if (!busy && !o.applied) onChoose(choice);
              }}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ${o.applied ? '' : 'active:bg-field'}`}
            >
              <span
                aria-hidden="true"
                className={`mt-px grid size-5 shrink-0 place-items-center rounded-pill transition-shadow duration-150 ${EASE_OUT} ${
                  o.applied
                    ? 'shadow-[inset_0_0_0_1.5px_var(--c-ink)]'
                    : 'shadow-[inset_0_0_0_1.5px_var(--c-line-strong)]'
                }`}
              >
                {inFlight ? (
                  <Spinner size={14} />
                ) : o.applied ? (
                  <span className="size-2.5 rounded-pill bg-ink starting:scale-50 transition-transform duration-150" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="type-row block text-pretty text-ink [overflow-wrap:anywhere]"
                  data-testid="option-label"
                >
                  {label(o)}
                </span>
                {parts.length > 0 ? (
                  <span
                    className="type-small mt-0.5 block text-pretty text-muted"
                    data-testid="option-detail"
                  >
                    <Joined parts={parts} />
                  </span>
                ) : null}
                {delivery ? (
                  <span
                    className="type-small mt-0.5 block text-muted tabular-nums"
                    data-testid="option-delivery"
                  >
                    {delivery}
                  </span>
                ) : null}
              </span>
              <span
                className={`type-price shrink-0 whitespace-nowrap tabular-nums ${o.applied ? 'text-ink' : 'text-muted'}`}
                data-testid="option-total"
              >
                {formatMoney(o.total, language)}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

type ChoiceText = ReturnType<typeof useDiscountsText>['choice'];

/** «Купон ко дню рождения», «Промокод BLOGER5», or «Выбранная скидка» when it is not named. */
function lapsedName(what: LapsedDiscount | null, m: ChoiceText['lapsed']['what']): string {
  if (what === null) return m.unknown;
  return what.type === 'promo_code' ? fill(m.promo_code, { code: what.code }) : m[sourceOf(what)];
}

/** «применили скидку за набор», or «сейчас скидки нет»: what the cart's quote applies now. */
function appliedNow(d: Discount | null, m: ChoiceText['lapsed']['now']): string {
  if (d === null) return m.none;
  return d.type === 'promo_code' ? fill(m.promo_code, { code: d.code }) : m[sourceOf(d)];
}

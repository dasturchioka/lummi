import type {
  CartDto,
  CartLineDto,
  Discount,
  DiscountChoiceDto,
  DiscountOptionDto,
} from '@lummi/contracts';
import { fill, formatCalendarDate, formatMoney } from '@lummi/i18n';
import { Fragment, type ReactNode } from 'react';
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
 * put when tapped. Everything shown is the server's: the Mini App adds and compares nothing. A
 * chosen discount that went stale says so at the top, alone when nothing is left to choose.
 */
export function DiscountChoice({
  cart,
  stale,
  busy,
  pending,
  onChoose,
}: {
  cart: CartDto;
  /** The chosen discount no longer applied and the server fell back (#39). */
  stale: boolean;
  busy: boolean;
  /** The key (`choiceKey`) of the choice in flight. */
  pending?: string;
  onChoose: (c: DiscountChoiceDto) => void;
}) {
  const { t, language } = usePrefs();
  const c = useDiscountsText().choice;
  const d = useDiscountsText();
  const options = cart.discountOptions;
  const until = (lastDay: string) => fill(d.until, { date: formatCalendarDate(lastDay, language) });
  const notice = stale ? (
    <p
      className="type-small flex items-start gap-1.5 text-pretty font-medium text-ink"
      data-testid="choice-stale"
      role="status"
    >
      <span aria-hidden="true" className="flex h-[18px] shrink-0 items-center">
        <AlertIcon size={14} />
      </span>
      <span className="min-w-0">{c.stale}</span>
    </p>
  ) : null;
  if (options.length === 0) return notice ? <div className="mt-3 px-1">{notice}</div> : null;

  const keeps = options.some((o) => o.terms !== null);
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
    return fill(x.type === 'upgrade_right' ? c.right[x.source] : c.coupon, { percent });
  };
  const detail = (o: DiscountOptionDto): ReactNode[] => {
    if (o.discount === null) return keeps ? [c.noneKeeps] : [];
    const bottle = bottleOf(o.discount, cart.lines, c.bottle);
    return [
      <span key="amount" className="whitespace-nowrap text-sage-ink tabular-nums">
        −{formatMoney(o.discount.amount, language)}
      </span>,
      ...(bottle ? [bottle] : []),
      ...(o.terms ? [<span className="whitespace-nowrap">{until(o.terms.lastDay)}</span>] : []),
    ];
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
          <div
            className="mt-3 flex items-center gap-3 rounded-btn bg-sage-wash py-2.5 pr-2.5 pl-3 shadow-[inset_0_0_0_1px_var(--c-sage)]"
            data-testid="choice-better"
          >
            <p className="min-w-0 flex-1 text-pretty">
              <span
                className="type-small block font-semibold text-sage-ink"
                data-testid="better-text"
              >
                {fill(c.better[better.type === 'upgrade_right' ? better.source : better.type], {
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

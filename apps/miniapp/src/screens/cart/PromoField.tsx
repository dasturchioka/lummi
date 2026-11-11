import type { CartDto, Quote } from '@lummi/contracts';
import { normalizePromoCode } from '@lummi/contracts/constants';
import { fill, formatCalendarDate, formatMoney } from '@lummi/i18n';
import { useEffect, useRef, useState } from 'react';
import { promoNextText, promoReasonText, promoWaitText } from '../../cart/promo';
import { useDiscountsText } from '../../discounts/queries';
import { usePrefs } from '../../lib/prefs';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { AlertIcon, CheckIcon, CloseIcon, Spinner, TagIcon } from '../../ui/icons';

/** What the field's last request left to say about the code it sent, beside the server cart. */
export type PromoNotice =
  { kind: 'tooMany'; code: string; seconds: number } | { kind: 'failed'; code: string } | null;

/** The line under the field: what happened, and (for a refusal) what the shopper can do. */
type Status = { tone: 'ok' | 'alert' | 'muted'; text: string; next?: string };

const EASE_OUT = 'ease-[cubic-bezier(0.23,1,0.32,1)]';
/** The field shows the stored code when it reads as that code (the server's own normalisation). */
const same = (typed: string, stored: string | null) =>
  stored !== null && normalizePromoCode(typed) === stored;

/**
 * The keyboard is up: Telegram has shrunk the WebView (Android) or the visual viewport (iOS) to
 * what is left above it, and the shell has put the tab bar away. The WebView scrolls just the
 * caret into view; the field is lifted further, so the top of the totals under it shows too (the
 * clearance is the block's scroll-margin-bottom, which the browser's own focus scroll honours).
 */
function liftAboveKeyboard(block: HTMLElement | null, input: HTMLInputElement | null) {
  if (!block || !input || document.activeElement !== input) return;
  const vv = window.visualViewport;
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const clear = parseFloat(getComputedStyle(block).scrollMarginBottom) || 0;
  const over = block.getBoundingClientRect().bottom + clear - bottom;
  if (over > 0) window.scrollBy({ top: over, behavior: 'smooth' });
}

/**
 * The promo code field (approved variant 2: a white row with the tag, the code and a dark
 * «Применить»). The code stays editable: while it is the stored one, the row offers to remove it
 * and the line under it says what the server's quote made of it (applied and for how much, or
 * why not and what to do); a changed code offers «Применить». The quote is the only judge: nothing
 * is checked here, and a refused code never blocks the order.
 */
export function PromoField({
  stored,
  quote,
  busy,
  pending,
  notice,
  couponWaiting = null,
  onApply,
  onRemove,
}: {
  /** The code in the server cart, upper-case. */
  stored: string | null;
  quote: Quote;
  /** Another cart change is in flight: taps wait for it. */
  busy: boolean;
  pending?: 'apply' | 'remove';
  notice: PromoNotice;
  /** The birthday coupon the applied code keeps out, as the server judged it (#30). */
  couponWaiting?: CartDto['birthdayCouponWaiting'];
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const { t, language } = usePrefs();
  const p = t.cart.promo;
  const d = useDiscountsText();
  const [draft, setDraft] = useState(stored ?? '');
  // The server's code wins whenever it changes (applied here, removed, taken by an order).
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setDraft(stored ?? '');
  }
  const block = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lift = () => liftAboveKeyboard(block.current, input.current);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => liftAboveKeyboard(block.current, input.current);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const typed = draft.trim();
  const showsStored = same(draft, stored);
  const canApply = typed !== '' && !showsStored;

  const entered = quote.promoCode;
  const discount = quote.discount?.type === 'promo_code' ? quote.discount : null;
  const applied = showsStored && discount !== null;
  let status: Status | null = null;
  // a refused or failed request speaks while the field still holds the code it sent
  if (notice && normalizePromoCode(draft) === normalizePromoCode(notice.code))
    status =
      notice.kind === 'tooMany'
        ? { tone: 'alert', text: p.tooMany, next: promoWaitText(notice.seconds, t, language) }
        : { tone: 'alert', text: p.failed, next: p.failedNext };
  else if (applied)
    status = {
      tone: 'ok',
      text: fill(p.applied, { amount: formatMoney(discount.amount, language) }),
    };
  else if (showsStored && entered?.invalid)
    status = {
      tone: 'alert',
      text: promoReasonText(entered.invalid, t, language),
      next: promoNextText(entered.invalid, t),
    };
  else if (showsStored && entered) status = { tone: 'muted', text: p.notChosen };

  const submit = () => {
    if (busy || !canApply) return;
    onApply(typed);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  return (
    <section
      ref={block}
      // pb-1: the focus ring's 4 px, which the totals' positioned ground would otherwise paint over;
      // scroll-mb: with the keyboard up, the totals' first row stays in view under the field
      className="mt-3 scroll-mb-16 pb-1"
      aria-label={p.label}
      data-testid="promo"
    >
      <Card className="p-1.5 pl-3.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-sage">
        <form
          noValidate
          className="flex items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TagIcon
            size={18}
            className={`shrink-0 transition-colors duration-200 ${applied ? 'text-sage-ink' : 'text-muted'}`}
          />
          <input
            ref={input}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // typing scrolls the caret into view, which stops a lift still under way
              requestAnimationFrame(lift);
            }}
            // a keyboard already up does not resize the viewport again
            onFocus={() => requestAnimationFrame(lift)}
            aria-label={p.label}
            placeholder={p.label}
            maxLength={64}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-describedby={status ? 'promo-status' : undefined}
            data-testid="promo-input"
            // 16 px: iOS zooms into anything smaller. The code reads upper-case, the placeholder
            // not; a code longer than the row ends in an ellipsis until the field is focused.
            className="h-11 min-w-0 flex-1 bg-transparent text-base font-semibold tracking-[0.04em] text-ellipsis text-ink uppercase outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-muted placeholder:normal-case"
          />
          {showsStored ? (
            <button
              type="button"
              aria-label={p.remove}
              aria-busy={pending === 'remove' || undefined}
              aria-disabled={busy || undefined}
              data-testid="promo-remove"
              onClick={() => {
                if (!busy) onRemove();
              }}
              // it takes the button's place once the code is the stored one: fades in, not snaps
              className={`relative grid size-9 shrink-0 place-items-center rounded-btn text-muted transition-[color,background-color,scale,opacity] duration-150 ${EASE_OUT} after:absolute after:-inset-1 after:content-[''] hover:text-ink active:scale-[0.94] active:bg-field active:text-ink starting:scale-[0.92] starting:opacity-0`}
            >
              {pending === 'remove' ? <Spinner size={16} /> : <CloseIcon size={18} />}
            </button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={!canApply}
              loading={pending === 'apply'}
              aria-disabled={busy || undefined}
              data-testid="promo-apply"
              className="h-9 shrink-0 starting:scale-[0.92] starting:opacity-0"
            >
              {p.apply}
            </Button>
          )}
        </form>
      </Card>
      <div aria-live="polite">
        {status ? (
          <p
            key={status.text}
            id="promo-status"
            data-testid="promo-status"
            data-tone={status.tone}
            className={`type-small mt-2 flex items-start gap-1.5 px-1 text-pretty animate-[rise-in_0.22s_cubic-bezier(0.23,1,0.32,1)] ${
              status.tone === 'ok'
                ? 'text-sage-ink'
                : status.tone === 'alert'
                  ? 'font-medium text-ink'
                  : 'text-muted'
            }`}
          >
            {status.tone === 'muted' ? null : (
              <span aria-hidden="true" className="flex h-[18px] shrink-0 items-center">
                {status.tone === 'ok' ? <CheckIcon size={15} /> : <AlertIcon size={14} />}
              </span>
            )}
            <span className="min-w-0">
              {status.text}
              {status.next ? (
                <span className="block font-normal text-muted">{status.next}</span>
              ) : null}
            </span>
          </p>
        ) : null}
        {applied && couponWaiting ? (
          // ADR 0002: the entered code wins; the coupon waits, and taking the code out lets the
          // server pick it (#39 builds the full switch)
          <p className="type-small mt-1.5 px-1 text-pretty text-muted" data-testid="coupon-waiting">
            {fill(d.couponWaits, {
              percent: String(couponWaiting.percent),
              date: formatCalendarDate(couponWaiting.lastDay, language),
            })}{' '}
            <button
              type="button"
              aria-disabled={busy || undefined}
              data-testid="coupon-use"
              onClick={() => {
                if (!busy) onRemove();
              }}
              className="-my-1 inline rounded-btn py-1 font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color,opacity] duration-150 hover:decoration-current active:opacity-60"
            >
              {d.useCoupon}
            </button>
          </p>
        ) : null}
      </div>
    </section>
  );
}

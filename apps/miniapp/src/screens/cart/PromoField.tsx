import type { Quote } from '@lummi/contracts';
import { useState } from 'react';
import { promoReasonText, promoWaitText } from '../../cart/promo';
import { usePrefs } from '../../lib/prefs';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { AlertIcon, CheckIcon, CloseIcon, Spinner, TagIcon } from '../../ui/icons';

/** What the field's last request left to say about the code it sent, beside the server cart. */
export type PromoNotice =
  { kind: 'tooMany'; code: string; seconds: number } | { kind: 'failed'; code: string } | null;

const EASE_OUT = 'ease-[cubic-bezier(0.23,1,0.32,1)]';
const same = (typed: string, stored: string | null) =>
  stored !== null && typed.trim().toUpperCase() === stored;

/**
 * The promo code field (approved variant 2: a white row with the tag, the code and a dark
 * «Применить»). The code stays editable: while it is the stored one, the row offers to remove it
 * and the line under it says what the server's quote made of it (applied, or why not); a changed
 * code offers «Применить». The quote is the only judge: nothing is checked here, and a refused
 * code never blocks the order.
 */
export function PromoField({
  stored,
  quote,
  busy,
  pending,
  notice,
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
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const { t, language } = usePrefs();
  const p = t.cart.promo;
  const [draft, setDraft] = useState(stored ?? '');
  // The server's code wins whenever it changes (applied here, removed, taken by an order).
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setDraft(stored ?? '');
  }
  const typed = draft.trim();
  const showsStored = same(draft, stored);
  const canApply = typed !== '' && !showsStored;

  const entered = quote.promoCode;
  const applied = showsStored && quote.discount?.type === 'promo_code';
  let status: { tone: 'ok' | 'alert' | 'muted'; text: string } | null = null;
  // a refused or failed request speaks while the field still holds the code it sent
  if (notice && typed.toUpperCase() === notice.code.trim().toUpperCase())
    status = {
      tone: 'alert',
      text: notice.kind === 'tooMany' ? promoWaitText(notice.seconds, t, language) : p.failed,
    };
  else if (applied) status = { tone: 'ok', text: p.applied };
  else if (showsStored && entered?.invalid)
    status = { tone: 'alert', text: promoReasonText(entered.invalid, t, language) };
  else if (showsStored && entered) status = { tone: 'muted', text: p.notChosen };

  const submit = () => {
    if (busy || !canApply) return;
    onApply(typed);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  return (
    <section className="mt-3" aria-label={p.label} data-testid="promo">
      <Card className="p-1.5 pl-3.5">
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
            // 16 px: iOS zooms into anything smaller; the code reads upper-case, the placeholder not
            className="h-11 min-w-0 flex-1 bg-transparent text-base font-semibold tracking-[0.04em] text-ink uppercase outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-muted placeholder:normal-case"
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
              className={`relative grid size-9 shrink-0 place-items-center rounded-btn text-muted transition-[color,background-color,transform] duration-150 ${EASE_OUT} after:absolute after:-inset-1 after:content-[''] hover:text-ink active:scale-[0.94] active:bg-field active:text-ink`}
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
              className="h-9 shrink-0"
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
            <span className="min-w-0">{status.text}</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

import type { RepeatResultDto } from '@lummi/contracts';
import { CART_MAX_QTY, orderRepeatable, type OrderStatus } from '@lummi/contracts/constants';
import { fill, plural } from '@lummi/i18n';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { hapticSuccess } from '../lib/telegram';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { AlertIcon, RefreshIcon, Spinner } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { useOrdersText, useRepeatOrder } from './queries';

type ResultLine = RepeatResultDto['lines'][number];

/** Why a line came back short, in the shopper's words: exactly the server's reason, no other. */
function useReasonText() {
  const o = useOrdersText();
  return (l: ResultLine): string => {
    const n = { added: String(l.added), ordered: String(l.ordered), max: String(CART_MAX_QTY) };
    switch (l.reason) {
      case 'sold_out':
        return o.orders.repeatReason.sold_out;
      case 'set_incomplete':
        return o.orders.repeatReason.set_incomplete;
      case 'capped':
        return fill(o.orders.repeatReason.capped, n);
      case 'max_qty':
        return fill(
          l.added > 0 ? o.orders.repeatReason.max_qty : o.orders.repeatReason.max_qty_none,
          n,
        );
      case null:
        return '';
    }
  };
}

/**
 * A line that came back short: the name in the italic of every fragrance and set name, its volume
 * beside it, then the server's reason in calm words under them. A line that went in at all keeps
 * its ink; one that did not steps back.
 */
function ShortLine({ line: l }: { line: ResultLine }) {
  const { t, language } = usePrefs();
  const reason = useReasonText();
  return (
    <li data-reason={l.reason} className="flex flex-col gap-1 px-4 py-3">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={`type-name text-[18px] text-pretty [overflow-wrap:anywhere] ${l.added === 0 ? 'text-muted' : 'text-ink'}`}
        >
          {l.name[language]}
        </span>
        {l.kind === 'volume' ? (
          <span className="type-small whitespace-nowrap text-muted">
            <span className="sr-only">, </span>
            {l.ml} {t.card.ml}
          </span>
        ) : null}
      </span>
      <span className="type-small text-pretty text-muted">{reason(l)}</span>
    </li>
  );
}

/**
 * The answer to «Повторить заказ»: how many lines went in («Добавили 2 из 3 товаров», «Всё
 * добавили в корзину», or nothing), each line that came back short with the server's reason, and
 * the way on: the cart when something went in, else the catalog.
 */
function RepeatSheet({
  result,
  open,
  onOpenChange,
}: {
  result: RepeatResultDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, language } = usePrefs();
  const o = useOrdersText();
  const router = useRouter();
  const r = result;
  const title = !r
    ? ''
    : r.added === 0
      ? o.orders.repeatNoneTitle
      : r.added === r.of
        ? o.orders.repeatAllTitle
        : fill(plural(language, r.of, o.orders.repeatSomeTitle), { added: String(r.added) });
  const short = r?.lines.filter((l) => l.reason !== null) ?? [];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={r && r.added > 0 ? o.orders.repeatPrices : o.orders.repeatNoneText}
      closeLabel={t.common.close}
    >
      <div className="flex flex-col gap-4 pb-1" data-testid="repeat-result">
        {short.length > 0 ? (
          <Card as="ul" className="divide-y divide-line overflow-hidden">
            {short.map((l, i) => (
              <ShortLine key={i} line={l} />
            ))}
          </Card>
        ) : null}
        {r && r.added > 0 ? (
          <Button block onClick={() => void router.navigate({ to: '/cart' })}>
            {o.orders.toCart}
          </Button>
        ) : (
          <Button block onClick={() => void router.navigate({ to: '/catalog' })}>
            {o.orders.toCatalog}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Runs «Повторить заказ» for one order and holds its sheet; the trigger is the caller's. */
function useRepeatFlow(number: number) {
  const o = useOrdersText();
  const repeat = useRepeatOrder(number);
  const [result, setResult] = useState<RepeatResultDto | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setError(null);
    repeat.mutate(undefined, {
      onSuccess: (out) => {
        if (out.kind === 'not_repeatable') return setError(o.orders.repeatNotYet);
        if (out.result.added > 0) hapticSuccess();
        setResult(out.result);
        setOpen(true);
      },
      onError: () => setError(o.orders.repeatFailed),
    });
  };
  const sheet = <RepeatSheet result={result} open={open} onOpenChange={setOpen} />;
  return { run, pending: repeat.isPending, error, sheet };
}

function RepeatError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="type-small mt-2 flex items-start gap-2 text-ink">
      <span className="mt-px shrink-0">
        <AlertIcon size={16} />
      </span>
      {text}
    </p>
  );
}

/**
 * «Повторить заказ» on the order page (spec Changes 2026-11-07 cart, 2026-11-11): a secondary
 * button, only on a delivered or cancelled order (the server refuses the others).
 */
export function RepeatOrder({ number, status }: { number: number; status: OrderStatus }) {
  const o = useOrdersText();
  const flow = useRepeatFlow(number);
  if (!orderRepeatable(status)) return null;
  return (
    <div className="mt-6">
      <Button
        block
        variant="secondary"
        loading={flow.pending}
        onClick={flow.run}
        data-testid="repeat-order"
      >
        <RefreshIcon size={18} />
        {o.orders.repeat}
      </Button>
      <RepeatError text={flow.error} />
      {flow.sheet}
    </div>
  );
}

/**
 * «Повторить заказ» under a delivered or cancelled row of «Заказы» (mockup 08: a quiet underlined
 * link below the row). It is the row's sibling, never inside the row's button.
 */
export function RepeatLink({ number, status }: { number: number; status: OrderStatus }) {
  const o = useOrdersText();
  const flow = useRepeatFlow(number);
  if (!orderRepeatable(status)) return null;
  return (
    <div className="-mt-1.5 px-4 pb-3.5">
      <button
        type="button"
        onClick={flow.run}
        disabled={flow.pending}
        data-testid="repeat-link"
        className="type-small -my-3 -ml-1 inline-flex items-center gap-1.5 rounded-btn px-1 py-3 font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color,opacity] duration-150 hover:decoration-current active:opacity-60 disabled:no-underline"
      >
        {o.orders.repeat}
        {flow.pending ? <Spinner size={14} /> : null}
      </button>
      <RepeatError text={flow.error} />
      {flow.sheet}
    </div>
  );
}

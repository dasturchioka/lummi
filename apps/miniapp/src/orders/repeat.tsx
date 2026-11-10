import type { OrderDto, RepeatResultDto } from '@lummi/contracts';
import { fill, plural } from '@lummi/i18n';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { hapticSuccess } from '../lib/telegram';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { AlertIcon, RefreshIcon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { useOrdersText, useRepeatOrder } from './queries';

/**
 * «Повторить заказ» (spec Changes 2026-11-07 cart, 2026-11-11): the order's lines go into the cart
 * at today's prices. The sheet then says how many went in («Добавили 2 из 3 товаров»), names the
 * lines that are not available and the ones that went in with fewer units, exactly as the server
 * reported them, and leads on to the cart. Offered on every order, cancelled ones too.
 */
export function RepeatOrder({ order }: { order: OrderDto }) {
  const { t, language } = usePrefs();
  const o = useOrdersText();
  const router = useRouter();
  const repeat = useRepeatOrder(order.number);
  const [result, setResult] = useState<RepeatResultDto | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = () => {
    setFailed(false);
    repeat.mutate(undefined, {
      onSuccess: (r) => {
        if (r.added > 0) hapticSuccess();
        setResult(r);
        setOpen(true);
      },
      onError: () => setFailed(true),
    });
  };
  const r = result;
  const title = !r
    ? ''
    : r.added === 0
      ? o.orders.repeatNoneTitle
      : r.added === r.of
        ? o.orders.repeatAllTitle
        : fill(plural(language, r.of, o.orders.repeatSomeTitle), { added: String(r.added) });
  const skipped = r?.lines.filter((l) => l.added === 0) ?? [];
  const capped = r?.lines.filter((l) => l.added > 0 && l.added < l.ordered) ?? [];
  const lineName = (l: RepeatResultDto['lines'][number]) =>
    l.kind === 'volume' ? `${l.name[language]}, ${l.ml} ${t.card.ml}` : l.name[language];
  return (
    <>
      <div className="mt-6">
        <Button
          block
          variant="secondary"
          loading={repeat.isPending}
          onClick={run}
          data-testid="repeat-order"
        >
          <RefreshIcon size={18} />
          {o.orders.repeat}
        </Button>
        {failed ? (
          <p role="alert" className="type-small mt-2 flex items-start gap-2 text-ink">
            <span className="mt-px shrink-0">
              <AlertIcon size={16} />
            </span>
            {o.orders.repeatFailed}
          </p>
        ) : null}
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={r && r.added > 0 ? o.orders.repeatPrices : o.orders.repeatNoneText}
        closeLabel={t.common.close}
      >
        <div className="flex flex-col gap-4 pb-1" data-testid="repeat-result">
          {skipped.length > 0 || capped.length > 0 ? (
            <Card as="ul" className="divide-y divide-line overflow-hidden">
              {skipped.map((l, i) => (
                <li key={`s${i}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <span className="type-body min-w-0 [overflow-wrap:anywhere] text-muted">
                    {lineName(l)}
                  </span>
                  <span className="type-small shrink-0 text-muted">{o.orders.repeatSkipped}</span>
                </li>
              ))}
              {capped.map((l, i) => (
                <li key={`c${i}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <span className="type-body min-w-0 [overflow-wrap:anywhere]">{lineName(l)}</span>
                  <span className="type-small shrink-0 text-right text-muted">
                    {fill(o.orders.repeatCapped, {
                      added: String(l.added),
                      ordered: String(l.ordered),
                    })}
                  </span>
                </li>
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
    </>
  );
}

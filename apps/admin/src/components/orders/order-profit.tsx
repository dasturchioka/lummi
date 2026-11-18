'use client';

import type { AdminOrderCostsDto, AdminOrderDto } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { useEffect, useRef, useState } from 'react';
import { OrderCostRows, ProfitLine, Row } from '@/components/profitability/cost-rows';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';

/**
 * The order's profit (#77), the owner's only (a manager's page has no `initial`): the cost
 * snapshot frozen when the payment was confirmed, each line at its unit cost, the order costs and
 * the profit with its margin. It reloads when the page's payment state changes (the snapshot is
 * written with the confirmation); later oil prices and settings never change it.
 */
export function OrderProfitSection({
  page,
  initial,
  t,
  language,
}: {
  page: AdminOrderDto;
  initial: AdminOrderCostsDto;
  t: AdminMessages;
  language: Language;
}) {
  const b = t.profitability.orderBlock;
  const money = (n: number) => formatMoney(n, language);
  const [costs, setCosts] = useState(initial);
  const [failed, setFailed] = useState(false);
  const number = page.order.number;
  const seen = useRef(page.payment);
  useEffect(() => {
    if (seen.current === page.payment) return;
    seen.current = page.payment;
    const ctl = new AbortController();
    browserApi.orders
      .costs({ params: { number }, fetchOptions: { signal: ctl.signal } })
      .then((res) => {
        if (res.status === 200) {
          setCosts(res.body);
          setFailed(false);
        } else setFailed(true);
      })
      .catch(() => !ctl.signal.aborted && setFailed(true));
    return () => ctl.abort();
  }, [number, page.payment]);

  const snapshot = costs.snapshot;
  return (
    <Section title={b.title}>
      <div className="-mt-1 grid gap-4" data-profit>
        {failed && <Notice title={b.failed} />}
        {!snapshot ? (
          <p className="text-sm text-pretty text-muted-foreground">
            {page.payment === 'paid' ? b.noSnapshot : b.notYet}
          </p>
        ) : !snapshot.costs ? (
          <Notice title={fill(t.profitability.noCost, { names: snapshot.missing.join(', ') })} />
        ) : (
          <>
            <dl className="grid gap-1.5 text-sm">
              <Row
                label={t.profitability.costs.revenue}
                value={money(snapshot.costs.revenue)}
                strong
              />
              {page.order.lines.map((l, i) => {
                const c = costs.lines[i];
                const name =
                  l.kind === 'volume'
                    ? `${l.name[language]}, ${fill(t.profitability.ml, { ml: String(l.ml) })}`
                    : l.name[language];
                return (
                  <Row
                    key={i}
                    label={fill(b.line, { name, qty: String(l.qty) })}
                    value={c?.cost === null || c === undefined ? b.unknownLine : money(c.cost)}
                    className="text-small"
                  />
                );
              })}
            </dl>
            <OrderCostRows costs={snapshot.costs} language={language} t={t} />
            <ProfitLine costs={snapshot.costs} language={language} t={t} />
          </>
        )}
        {snapshot && (
          <p className="text-small text-pretty text-muted-foreground tabular-nums">
            {fill(b.frozen, { at: formatTashkent(snapshot.at) })}
          </p>
        )}
      </div>
    </Section>
  );
}

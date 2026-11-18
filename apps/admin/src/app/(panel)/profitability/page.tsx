import type {
  ProfitabilityQuote,
  ProfitabilityQuoteBody,
  ProfitabilityTable,
} from '@lummi/contracts';
import { Download } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { ProfitabilityControls, Dimmed, ViewNav } from '@/components/profitability/controls';
import { CalculatorPicker, OrderLinesEditor } from '@/components/profitability/pickers';
import { ProfitabilityTableView } from '@/components/profitability/profitability-table';
import { CalculatorResult, OrderResult } from '@/components/profitability/results';
import {
  hrefOf,
  readView,
  tableQuery,
  TABS,
  type FragranceOption,
  type View,
} from '@/components/profitability/view';
import { TabLinks } from '@/components/tab-links';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { getAdminMessages } from '@/lib/i18n';
import type { Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

/** The fragrances the calculator and the simulator offer, by name, with the volumes they sell. */
function optionsOf(table: ProfitabilityTable): FragranceOption[] {
  const byId = new Map<number, FragranceOption>();
  for (const r of table.rows) {
    if (r.kind !== 'volume' || r.fragranceId === null) continue;
    const o = byId.get(r.fragranceId) ?? {
      id: r.fragranceId,
      name: r.name,
      brand: r.brand,
      mls: [],
    };
    o.mls.push(r.ml);
    byId.set(r.fragranceId, o);
  }
  return [...byId.values()];
}

/** The sale the calculator or the simulator asks the API about; null when nothing is chosen. */
function quoteBody(view: View, options: FragranceOption[]): ProfitabilityQuoteBody | null {
  const base = {
    channel: view.channel,
    afterSetDiscount: view.afterSetDiscount,
    giftSample: view.giftSample,
  };
  if (view.tab === 'calculator') {
    if (view.set) return { ...base, lines: [{ item: { kind: 'discovery_set' }, qty: 1 }] };
    const f = options.find((o) => o.id === view.fragrance);
    const ml = f && view.calcMl !== null && f.mls.includes(view.calcMl) ? view.calcMl : null;
    return f && ml !== null
      ? { ...base, lines: [{ item: { kind: 'volume', fragranceId: f.id, ml }, qty: 1 }] }
      : null;
  }
  if (view.tab === 'order' && view.lines.length > 0)
    return {
      ...base,
      lines: view.lines.map((l) => ({
        item:
          l.item === 'set'
            ? { kind: 'discovery_set' as const }
            : { kind: 'volume' as const, fragranceId: l.item.fragrance, ml: l.item.ml },
        qty: l.qty,
      })),
    };
  return null;
}

/**
 * «Рентабельность» (#77), the owner's: the table of every sale, the calculator and the order
 * simulator, each rendered from the URL with the API's figures.
 */
export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const view = readView(await searchParams);
  const api = await serverApi();
  const res = await api.profitability.table({ query: tableQuery(view) });
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/'); // the owner's, as reports are
  if (res.status !== 200) throw new Error(`profitability failed to load: ${res.status}`);
  const table = res.body;
  const options = optionsOf(table);
  const setAvailable = table.rows.some((r) => r.kind === 'discovery_set');

  // the calculator opens on the first fragrance's largest volume until one is chosen
  const first = options[0];
  const shown: View =
    view.tab === 'calculator' && !view.set && view.fragrance === null && first
      ? { ...view, fragrance: first.id, calcMl: first.mls.at(-1) ?? null }
      : view;
  const body = quoteBody(shown, options);
  let quote: ProfitabilityQuote | null = null;
  let stale = false;
  if (body) {
    const q = await api.profitability.quote({ body });
    if (q.status === 200) quote = q.body;
    else if (q.status === 404 || q.status === 400) stale = true;
    else if (q.status === 401) redirect('/login');
    else throw new Error(`profitability quote failed: ${q.status}`);
  }

  const { language, t } = await getAdminMessages();
  const p = t.profitability;
  const exportHref = `/api/admin/profitability/export?${new URLSearchParams({
    ...tableQuery(view),
    lang: language,
  })}`;

  return (
    <ViewNav view={shown}>
      <PageHeader
        title={p.title}
        description={p.description}
        actions={
          view.tab === 'table' ? (
            <Button asChild variant="outline">
              <a href={exportHref} download>
                <Download strokeWidth={1.5} aria-hidden />
                {p.export}
              </a>
            </Button>
          ) : undefined
        }
      />
      <TabLinks
        label={p.tabs.label}
        current={view.tab}
        items={TABS.map((tab) => ({ key: tab, href: hrefOf(shown, { tab }), label: p.tabs[tab] }))}
      />
      <ProfitabilityControls afterSetPercent={table.afterSetDiscountPercent} t={t} />

      {view.tab === 'table' && (
        <Dimmed>
          <ProfitabilityTableView data={table} view={view} language={language} t={t} />
        </Dimmed>
      )}

      {view.tab === 'calculator' && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Card className="p-4 sm:p-5">
            <CalculatorPicker options={options} setAvailable={setAvailable} t={t} />
          </Card>
          <Dimmed>
            {stale ? (
              <Notice title={p.stale} />
            ) : quote ? (
              <CalculatorResult
                quote={quote}
                channel={view.channel}
                lowMarginPercent={table.lowMarginPercent}
                language={language}
                t={t}
              />
            ) : null}
          </Dimmed>
        </div>
      )}

      {view.tab === 'order' && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-4 font-display text-[13px] leading-[1.35] tracking-[0.2em] uppercase">
              {p.order.title}
            </h2>
            <OrderLinesEditor options={options} setAvailable={setAvailable} t={t} />
          </Card>
          <Dimmed>
            {stale ? (
              <Notice title={p.stale} />
            ) : quote ? (
              <OrderResult
                quote={quote}
                channel={view.channel}
                afterSetDiscount={view.afterSetDiscount}
                lowMarginPercent={table.lowMarginPercent}
                language={language}
                t={t}
              />
            ) : null}
          </Dimmed>
        </div>
      )}
    </ViewNav>
  );
}

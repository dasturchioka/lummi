'use client';

import type { AdminPromoCodeRow } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { ArrowUpRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { countOf, num } from '@/components/broadcasts/format';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { CodeText } from './code-text';
import { conditionsOf, discountOf, usesOf } from './terms';

/**
 * The owner's promo codes, newest first, in the panel's list grammar (broadcasts, the catalog): a
 * count line, rows on phones, a table from 896 px. A tap anywhere on a row opens the editor; the
 * code is the keyboard path. Uses count orders that were not cancelled, against the total limit.
 */
export function PromoList({
  items,
  language,
  t,
}: {
  items: AdminPromoCodeRow[];
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const m = t.promo;
  const open = (p: AdminPromoCodeRow) => router.push(`/promo-codes/${p.id}`);

  const code = (p: AdminPromoCodeRow) => (
    <Link
      href={`/promo-codes/${p.id}`}
      onClick={(e) => e.stopPropagation()}
      className="rounded-sm text-[15px] leading-snug font-semibold tracking-[0.04em] [overflow-wrap:anywhere] underline-offset-[3px] hover:underline"
    >
      <CodeText code={p.code} />
    </Link>
  );
  const terms = (p: AdminPromoCodeRow) => (
    <MetaLine
      className="mt-1 text-small text-muted-foreground"
      parts={[
        <span key="off" className="font-medium text-foreground">
          {discountOf(p, t, language)}
        </span>,
        ...conditionsOf(p, t, language),
      ]}
    />
  );
  const state = (p: AdminPromoCodeRow) => (
    <Badge tone={p.state === 'active' ? 'sage' : 'neutral'}>{m.states[p.state]}</Badge>
  );
  const uses = (p: AdminPromoCodeRow) => (
    <span className={cn('font-semibold', p.uses === 0 && 'font-normal text-muted-foreground')}>
      {usesOf(p, t)}
    </span>
  );

  const fulfilled = (p: AdminPromoCodeRow) => (
    <span
      className={cn(
        'font-semibold',
        p.fulfilledOrders === 0 && 'font-normal text-muted-foreground',
      )}
    >
      {num(p.fulfilledOrders)}
    </span>
  );
  const net = (p: AdminPromoCodeRow) => (
    <span className={cn('font-semibold', p.netSales === 0 && 'font-normal text-muted-foreground')}>
      {formatMoney(p.netSales, language)}
    </span>
  );
  // the marketing report for this code over the same days the figures count
  const report = (p: AdminPromoCodeRow) => (
    <Link
      href={`/reports/marketing?from=${p.reportFrom}&to=${p.statsTo}&code=${encodeURIComponent(p.code)}`}
      onClick={(e) => e.stopPropagation()}
      aria-label={fill(m.reportLabel, { code: p.code })}
      className="inline-flex items-center gap-0.5 rounded-sm text-small text-muted-foreground underline-offset-[3px] transition-colors duration-150 hover:text-foreground hover:underline"
    >
      {m.report}
      <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
    </Link>
  );

  const add = (
    <Button asChild className="max-sm:w-full">
      <Link href="/promo-codes/new">
        <Plus strokeWidth={1.5} aria-hidden />
        {m.add}
      </Link>
    </Button>
  );
  return (
    <>
      <PageHeader title={m.title} description={m.description} actions={add} />
      {items.length === 0 ? (
        <EmptyState title={m.empty}>{m.emptyText}</EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {countOf(language, items.length, m.total)}
            <span className="mt-1 block text-[13px] leading-snug">{m.statsHint}</span>
          </p>
          <ul className="divide-y divide-border @4xl:hidden">
            {items.map((p) => (
              <li
                key={p.id}
                onClick={() => open(p)}
                className="grid cursor-pointer gap-2.5 px-4 py-4 transition-colors duration-150 hover:bg-milk/60 active:bg-milk @xl:px-5"
              >
                <div className="min-w-0">
                  {code(p)}
                  {terms(p)}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {state(p)}
                  <span className="text-small text-muted-foreground tabular-nums">
                    {m.columns.uses} {uses(p)}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-small text-muted-foreground tabular-nums">
                  <span>
                    {m.columns.fulfilled} {fulfilled(p)}
                  </span>
                  <span className="[overflow-wrap:anywhere]">
                    {m.columns.net} {net(p)}
                  </span>
                  {report(p)}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{m.columns.code}</TH>
                  <TH className="w-px text-right">{m.columns.uses}</TH>
                  <TH className="w-px text-right">{m.columns.fulfilled}</TH>
                  <TH className="text-right">{m.columns.net}</TH>
                  <TH className="w-px">{m.columns.state}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((p) => (
                  <TR
                    key={p.id}
                    onClick={() => open(p)}
                    className="cursor-pointer [&>td]:py-3.5 [&>td]:align-top"
                  >
                    <TD className="min-w-[18rem]">
                      {code(p)}
                      {terms(p)}
                    </TD>
                    <TD className="w-px pt-4 text-right whitespace-nowrap">{uses(p)}</TD>
                    <TD className="w-px pt-4 text-right whitespace-nowrap tabular-nums">
                      {fulfilled(p)}
                    </TD>
                    <TD className="pt-4 text-right tabular-nums">
                      <div className="whitespace-nowrap">{net(p)}</div>
                      <div className="mt-1">{report(p)}</div>
                    </TD>
                    <TD className="w-px pt-3.5 whitespace-nowrap">{state(p)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}

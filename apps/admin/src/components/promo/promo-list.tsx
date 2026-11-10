'use client';

import type { AdminPromoCode } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { countOf } from '@/components/broadcasts/format';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
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
  items: AdminPromoCode[];
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const m = t.promo;
  const open = (p: AdminPromoCode) => router.push(`/promo-codes/${p.id}`);

  const code = (p: AdminPromoCode) => (
    <Link
      href={`/promo-codes/${p.id}`}
      onClick={(e) => e.stopPropagation()}
      className="rounded-sm text-[15px] leading-snug font-semibold tracking-[0.04em] [overflow-wrap:anywhere] underline-offset-[3px] hover:underline"
    >
      {p.code}
    </Link>
  );
  const terms = (p: AdminPromoCode) => (
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
  const state = (p: AdminPromoCode) => (
    <Badge tone={p.state === 'active' ? 'sage' : 'neutral'}>{m.states[p.state]}</Badge>
  );
  const uses = (p: AdminPromoCode) => (
    <span className={cn('font-semibold', p.uses === 0 && 'font-normal text-muted-foreground')}>
      {usesOf(p, t)}
    </span>
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
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{m.columns.code}</TH>
                  <TH className="w-px text-right">{m.columns.uses}</TH>
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

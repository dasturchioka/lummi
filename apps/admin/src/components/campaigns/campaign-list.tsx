'use client';

import type { AdminCampaignLink } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { countOf } from '@/components/broadcasts/format';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { CodeText } from '@/components/promo/code-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { sourceLine, targetLine } from './source-line';

/**
 * The owner's campaign links, newest first, in the panel's list grammar (promo codes): rows on
 * phones, a table from 896 px. Opens count customers, not taps (ADR 0022).
 */
export function CampaignList({
  items,
  fragranceNames,
  language,
  t,
}: {
  items: AdminCampaignLink[];
  fragranceNames: Record<string, string>;
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const m = t.campaigns;
  const open = (l: AdminCampaignLink) => router.push(`/campaign-links/${l.id}`);
  const name = (slug: string) => fragranceNames[slug] ?? slug;

  const code = (l: AdminCampaignLink) => (
    <Link
      href={`/campaign-links/${l.id}`}
      onClick={(e) => e.stopPropagation()}
      className="rounded-sm text-[15px] leading-snug font-semibold tracking-[0.04em] [overflow-wrap:anywhere] underline-offset-[3px] hover:underline"
    >
      <CodeText code={l.code} />
    </Link>
  );
  const where = (l: AdminCampaignLink) => (
    <MetaLine
      className="mt-1 text-small text-muted-foreground"
      parts={[
        targetLine(l.target, t, name),
        ...(l.promoCode ? [<span key="p">{l.promoCode}</span>] : []),
      ]}
    />
  );
  const count = (n: number) => (
    <span
      className={cn('font-semibold tabular-nums', n === 0 && 'font-normal text-muted-foreground')}
    >
      {n}
    </span>
  );

  const add = (
    <Button asChild className="max-sm:w-full">
      <Link href="/campaign-links/new">
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
            {items.map((l) => (
              <li
                key={l.id}
                onClick={() => open(l)}
                className="grid cursor-pointer gap-2.5 px-4 py-4 transition-colors duration-150 hover:bg-milk/60 active:bg-milk @xl:px-5"
              >
                <div className="min-w-0">
                  {code(l)}
                  {where(l)}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-small text-muted-foreground">
                  <span className="[overflow-wrap:anywhere]">{sourceLine(l, t)}</span>
                  <span>
                    {m.columns.opens} {count(l.opens)}
                  </span>
                  <span>
                    {m.columns.orders} {count(l.orders)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{m.columns.link}</TH>
                  <TH>{m.columns.source}</TH>
                  <TH className="w-px text-right" title={m.opensHint}>
                    {m.columns.opens}
                  </TH>
                  <TH className="w-px text-right" title={m.ordersHint}>
                    {m.columns.orders}
                  </TH>
                </TR>
              </THead>
              <TBody>
                {items.map((l) => (
                  <TR
                    key={l.id}
                    onClick={() => open(l)}
                    className="cursor-pointer [&>td]:py-3.5 [&>td]:align-top"
                  >
                    <TD className="min-w-[18rem]">
                      {code(l)}
                      {where(l)}
                    </TD>
                    <TD className="pt-4 [overflow-wrap:anywhere]">{sourceLine(l, t)}</TD>
                    <TD className="w-px pt-4 text-right">{count(l.opens)}</TD>
                    <TD className="w-px pt-4 text-right">{count(l.orders)}</TD>
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

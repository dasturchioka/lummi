'use client';

import type { BroadcastDto } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ImageIcon, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { SageThread, settled } from './counts';
import { countOf, formatWhen, num } from './format';

const POLL_MS = 3000;
const COUNTS = ['sent', 'blocked', 'failed', 'pending'] as const;

/**
 * The history of broadcasts, newest first, in the panel's list grammar (the catalog and the audit
 * log): a count line, rows on phones, a table from 896 px. A tap anywhere on a row opens the
 * broadcast; its text is the keyboard path. While one is sending, the list refreshes its counts.
 */
export function BroadcastList({
  initial,
  language,
  t,
}: {
  initial: BroadcastDto[];
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const running = items.some((b) => b.status === 'sending');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const res = await browserApi.broadcasts.list().catch(() => null);
      if (res?.status === 200) setItems(res.body);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  const b = t.broadcasts;
  const open = (x: BroadcastDto) => router.push(`/broadcasts/${x.id}`);
  /** The version the customers got: RU or UZ for a one-language audience, else the panel's. */
  const shownLanguage = (x: BroadcastDto): Language =>
    x.audience === 'all' ? language : x.audience;

  /** The message (two lines at most) as the link, then when · to whom · who · with an image. */
  const title = (x: BroadcastDto) => (
    <>
      <Link
        href={`/broadcasts/${x.id}`}
        lang={shownLanguage(x)}
        onClick={(e) => e.stopPropagation()}
        className="line-clamp-2 rounded-sm text-[15px] leading-snug font-semibold [overflow-wrap:anywhere] underline-offset-[3px] hover:underline"
      >
        {shownLanguage(x) === 'uz' ? x.textUz : x.textRu}
      </Link>
      <MetaLine
        className="mt-1 text-small text-muted-foreground"
        parts={[
          <time key="when" dateTime={x.createdAt} className="tabular-nums">
            {formatWhen(x.createdAt, language)}
          </time>,
          b.audiences[x.audience],
          x.createdByName,
          x.hasImage && (
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
              {b.withImage}
            </span>
          ),
        ]}
      />
    </>
  );
  const status = (x: BroadcastDto) => (
    <Badge tone={x.status === 'sending' ? 'live' : 'sage'}>{b.status[x.status]}</Badge>
  );
  const thread = (x: BroadcastDto, className?: string) =>
    x.status === 'sending' ? (
      <SageThread
        value={settled(x.counts)}
        label={`${b.counts.total}: ${num(x.counts.total)}`}
        className={className}
      />
    ) : null;
  const value = (n: number) => (
    <span className={cn('font-semibold', n === 0 && 'font-normal text-muted-foreground')}>
      {num(n)}
    </span>
  );

  const add = (
    <Button asChild className="max-sm:w-full">
      <Link href="/broadcasts/new">
        <Plus strokeWidth={1.5} aria-hidden />
        {b.add}
      </Link>
    </Button>
  );
  return (
    <>
      <PageHeader title={b.title} description={b.description} actions={add} />
      {items.length === 0 ? (
        <EmptyState title={b.empty}>{b.emptyText}</EmptyState>
      ) : (
        <Card className="@container">
          <h2 className="sr-only">{b.historyTitle}</h2>
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {countOf(language, items.length, b.total)}
          </p>
          <ul className="divide-y divide-border @4xl:hidden">
            {items.map((x) => (
              <li
                key={x.id}
                onClick={() => open(x)}
                className="grid cursor-pointer gap-3 px-4 py-4 transition-colors duration-150 hover:bg-milk/60 active:bg-milk @xl:px-5"
              >
                <div className="min-w-0">{title(x)}</div>
                <div className="grid gap-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {status(x)}
                    <MetaLine
                      className="min-w-0 flex-1 basis-48 text-small text-muted-foreground tabular-nums"
                      parts={COUNTS.filter((k) => k !== 'pending' || x.counts.pending > 0).map(
                        (k) => (
                          <span key={k} className="whitespace-nowrap">
                            {b.counts[k]} {value(x.counts[k])}
                          </span>
                        ),
                      )}
                    />
                  </div>
                  {thread(x)}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{b.text}</TH>
                  {COUNTS.map((k) => (
                    <TH key={k} className="w-px text-right">
                      {b.counts[k]}
                    </TH>
                  ))}
                  <TH className="w-px">{b.state}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((x) => (
                  <TR
                    key={x.id}
                    onClick={() => open(x)}
                    className="cursor-pointer [&>td]:py-3.5 [&>td]:align-top"
                  >
                    <TD className="min-w-[18rem]">{title(x)}</TD>
                    {COUNTS.map((k) => (
                      <TD key={k} className="w-px pt-4 text-right whitespace-nowrap">
                        {value(x.counts[k])}
                      </TD>
                    ))}
                    <TD className="w-px pt-3.5 whitespace-nowrap">
                      <div className="grid gap-2">
                        {status(x)}
                        {thread(x)}
                      </div>
                    </TD>
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

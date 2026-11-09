'use client';

import type { BroadcastDto } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ImageIcon, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatWhen } from './format';

const POLL_MS = 3000;

/** The history of broadcasts: newest first; a row that is still sending refreshes its counts on its own. */
export function BroadcastList({
  initial,
  language,
  t,
}: {
  initial: BroadcastDto[];
  language: Language;
  t: AdminMessages;
}) {
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
        <EmptyState title={b.empty} action={add}>
          {b.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <h2 className="sr-only">{b.historyTitle}</h2>
          <ul className="divide-y divide-border">
            {items.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/broadcasts/${x.id}`}
                  className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-field focus-visible:bg-field @xl:flex-row @xl:items-center @xl:gap-6 @xl:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">
                      {language === 'uz' ? x.textUz : x.textRu}
                    </p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      <MetaLine
                        parts={[
                          formatWhen(x.createdAt, language),
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
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-[13px] tabular-nums">
                    <Badge tone={x.status === 'sending' ? 'neutral' : 'sage'}>
                      {b.status[x.status]}
                    </Badge>
                    <span>
                      <span className="text-muted-foreground">{b.counts.sent}: </span>
                      <b className="font-semibold">{x.counts.sent}</b>
                    </span>
                    <span>
                      <span className="text-muted-foreground">{b.counts.blocked}: </span>
                      <b className="font-semibold">{x.counts.blocked}</b>
                    </span>
                    <span>
                      <span className="text-muted-foreground">{b.counts.failed}: </span>
                      <b className="font-semibold">{x.counts.failed}</b>
                    </span>
                    {x.counts.pending > 0 && (
                      <span>
                        <span className="text-muted-foreground">{b.counts.pending}: </span>
                        <b className="font-semibold">{x.counts.pending}</b>
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

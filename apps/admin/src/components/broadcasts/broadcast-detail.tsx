'use client';

import type { BroadcastDto } from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { ArrowLeft, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';
import { TEXT_LINK } from '@/lib/ui-classes';
import { CountTiles } from './counts';
import { formatWhen } from './format';

const POLL_MS = 2000;

/** One broadcast: its counts (refreshed every two seconds while it sends) and the two texts as sent. */
export function BroadcastDetail({
  initial,
  language,
  t,
}: {
  initial: BroadcastDto;
  language: Language;
  t: AdminMessages;
}) {
  const [b, setB] = useState(initial);
  const sending = b.status === 'sending';
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(async () => {
      const res = await browserApi.broadcasts.get({ params: { id: initial.id } }).catch(() => null);
      if (res?.status === 200) setB(res.body);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [sending, initial.id]);

  const m = t.broadcasts;
  return (
    <>
      <PageHeader
        title={m.title}
        description={m.sentBy.replace('{name}', b.createdByName)}
        actions={
          <Link href="/broadcasts" className={TEXT_LINK}>
            <ArrowLeft className="mr-1.5 inline size-4" strokeWidth={1.5} aria-hidden />
            {m.back}
          </Link>
        }
      />
      <div className="grid gap-4 @container">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
          <Badge tone={sending ? 'neutral' : 'sage'}>{m.status[b.status]}</Badge>
          <MetaLine
            parts={[
              formatWhen(b.createdAt, language),
              m.audiences[b.audience],
              plural(language, b.counts.total, m.recipients),
              b.buttonTarget && fill(m.buttonTo, { target: b.buttonTarget }),
              b.hasImage && (
                <span className="inline-flex items-center gap-1">
                  <ImageIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
                  {m.withImage}
                </span>
              ),
            ]}
          />
        </div>
        <CountTiles counts={b.counts} t={t} />
        <p role="status" className="text-[13px] text-muted-foreground">
          {sending ? m.runningNote : m.doneNote}
        </p>
        <div className="grid gap-3 @3xl:grid-cols-2">
          {(['Ru', 'Uz'] as const).map((l) => (
            <Card key={l} className="px-4 py-4">
              <h2 className="text-[12.5px] font-medium text-muted-foreground">
                {m[`version${l}`]}
              </h2>
              <p className="mt-2 text-[15px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">
                {b[`text${l}`]}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

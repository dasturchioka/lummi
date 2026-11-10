'use client';

import type { BroadcastDto } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ArrowLeft, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MetaLine } from '@/components/ui/meta-line';
import { Section } from '@/components/ui/section';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { CountTiles } from './counts';
import { countOf, formatWhen } from './format';
import { TelegramPreview } from './telegram-preview';

const POLL_MS = 2000;

/** «Каталог», or «Аромат Tygar» for a `p_<slug>` target (the slug when the fragrance is gone). */
function targetLabel(b: BroadcastDto, m: AdminMessages['broadcasts']): string {
  const target = b.buttonTarget ?? '';
  if (target.startsWith('p_'))
    return fill(m.targetFragrance, { name: b.buttonFragrance ?? target.slice(2) });
  return (m.targets as Record<string, string>)[target] ?? target;
}

/**
 * One broadcast: who sent it and when, its counts (refreshed every two seconds while it sends),
 * and the two language versions as the customers got them.
 */
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
        title={m.detailTitle}
        description={`${formatWhen(b.createdAt, language)} · ${fill(m.sentBy, { name: b.createdByName })}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/broadcasts">
              <ArrowLeft strokeWidth={1.5} aria-hidden />
              {m.back}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
          <Badge tone={sending ? 'live' : 'sage'}>{m.status[b.status]}</Badge>
          <MetaLine
            className="min-w-0 flex-1 basis-56"
            parts={[
              m.audiences[b.audience],
              countOf(language, b.counts.total, m.customers),
              b.buttonTarget && fill(m.buttonTo, { target: targetLabel(b, m) }),
              b.hasImage && (
                <span className="inline-flex items-center gap-1">
                  <ImageIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
                  {m.withImage}
                </span>
              ),
            ]}
          />
        </div>
        <CountTiles counts={b.counts} sending={sending} t={t} />
        <div className="grid gap-4 lg:grid-cols-2">
          {/* the version the customers got comes first */}
          {(b.audience === 'uz' ? (['uz', 'ru'] as const) : (['ru', 'uz'] as const)).map((l) => {
            // a one-language audience never got the other version
            const unsent = b.audience !== 'all' && b.audience !== l;
            return (
              <Section key={l} title={l === 'ru' ? m.versionRu : m.versionUz}>
                {unsent && b.audience !== 'all' && (
                  <p className="-mt-2 text-[13px] text-pretty text-muted-foreground">
                    {m.versionUnsent[b.audience]}
                  </p>
                )}
                <TelegramPreview
                  text={l === 'ru' ? b.textRu : b.textUz}
                  image={b.hasImage ? 'placeholder' : null}
                  button={b.buttonTarget !== null}
                  language={l}
                  t={t}
                  className={cn(unsent && 'opacity-60')}
                />
              </Section>
            );
          })}
        </div>
      </div>
    </>
  );
}

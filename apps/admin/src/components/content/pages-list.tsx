import type { AdminInfoPage } from '@lummi/contracts';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

export function PagesList({
  pages,
  t,
  language,
}: {
  pages: AdminInfoPage[];
  t: AdminMessages;
  language: 'ru' | 'uz';
}) {
  const p = t.content.pages;
  const date = new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeZone: 'Asia/Tashkent',
  });
  return (
    <Card className="grid gap-4 p-4 sm:p-6" data-section="pages">
      <div>
        <h2 className="text-base font-semibold">{p.section}</h2>
        <p className="mt-1 max-w-[64ch] text-sm text-pretty text-muted-foreground">{p.hint}</p>
      </div>
      <ul className="divide-y divide-border">
        {pages.map((x) => (
          <li key={x.slug}>
            <Link
              href={`/content/pages/${x.slug}`}
              className="-mx-2 flex min-h-14 items-center gap-3 rounded-button px-2 py-2 transition-colors duration-150 hover:bg-field"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[15px] font-semibold [overflow-wrap:anywhere]">
                  {language === 'uz' ? x.titleUz : x.titleRu}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {fill(p.updated, { date: date.format(new Date(x.updatedAt)) })}
                </p>
              </div>
              <Badge tone={x.draft ? 'neutral' : 'sage'}>{x.draft ? p.draft : p.approved}</Badge>
              <ChevronRight
                className="size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

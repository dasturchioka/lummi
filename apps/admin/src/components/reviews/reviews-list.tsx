import type { AdminReviewDto, AdminReviewsPageDto } from '@lummi/contracts';
import { formatPhone, type Language } from '@lummi/i18n';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { formatTashkent, num } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';
import { PublishButton } from './publish-button';
import { ReviewBody } from './review-parts';
import { ReviewsTabs } from './reviews-tabs';
import { ReviewsFiltersForm, type ReviewFilters } from './reviews-filters';

function ReviewCard({ review, t }: { review: AdminReviewDto; t: AdminMessages }) {
  const text = t.reviews;
  return (
    <li className="grid gap-3 px-4 py-4 @xl:px-5 @3xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid min-w-0 gap-2">
        <ReviewBody review={review} t={t} />
        <MetaLine
          className="text-small text-muted-foreground tabular-nums"
          parts={[
            <span key="order" className="font-semibold whitespace-nowrap text-foreground">
              {fill(text.order, { number: String(review.orderNumber) })}
            </span>,
            <time key="at" dateTime={review.createdAt} className="whitespace-nowrap">
              {formatTashkent(review.createdAt)}
            </time>,
            <span key="who" className="text-foreground">
              {review.customerName}
            </span>,
            review.phone && (
              <span key="phone" className="whitespace-nowrap">
                {formatPhone(review.phone)}
              </span>
            ),
          ]}
        />
        <p className="text-small text-muted-foreground">
          {text.inOrder}: {review.items.join(', ')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 @3xl:items-end">
        {review.finished || review.published ? (
          <PublishButton id={review.id} published={review.published} t={t} />
        ) : (
          <p className="text-[13px] text-muted-foreground">{text.writingHint}</p>
        )}
        {!review.published && review.finished && (
          <p className="text-[13px] text-muted-foreground">{text.checkHint}</p>
        )}
        {review.publishedAt && (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {fill(text.publishedAt, { date: formatTashkent(review.publishedAt) })}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * The reviews panel (#41): filters (a GET form), the average and counts, the Excel export of the
 * same filters, then the reviews newest first with publish / hide. Reviews are private until
 * staff publish them, so the text (a banned word included) is shown exactly as typed.
 */
export function ReviewsList({
  t,
  language,
  data,
  filters,
}: {
  t: AdminMessages;
  language: Language;
  data: AdminReviewsPageDto;
  filters: ReviewFilters;
}) {
  const copy = t.reviews;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = Object.values(filters).some(Boolean);
  const href = (p: number) => listHref('/reviews', filters, p);
  const exportHref = `/api/admin/reviews/export${
    filtered ? `?${new URLSearchParams(filters as Record<string, string>)}` : ''
  }`;

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button asChild variant="outline">
            <a href={exportHref} download>
              <Download strokeWidth={1.5} aria-hidden />
              {copy.export}
            </a>
          </Button>
        }
      />

      <ReviewsTabs t={t} current="reviews" />
      <ReviewsFiltersForm t={t} filters={filters} />

      {data.items.length === 0 ? (
        <EmptyState
          title={filtered ? copy.emptyFiltered : copy.empty}
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/reviews">{copy.filters.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {filtered ? copy.emptyFilteredText : copy.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <dl className="grid grid-cols-3 gap-3 border-b border-border px-4 py-3 text-small @xl:px-5">
            <div>
              <dt className="text-muted-foreground">{copy.average}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                {data.average === null
                  ? copy.averageNone
                  : data.average.toLocaleString(language === 'uz' ? 'uz-UZ' : 'ru-RU', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.publishedCount}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                {num(data.publishedCount)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.totalLabel}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{num(data.total)}</dd>
            </div>
          </dl>
          <ul className="divide-y divide-border">
            {data.items.map((it) => (
              <ReviewCard key={it.id} review={it} t={t} />
            ))}
          </ul>
        </Card>
      )}

      <Pager
        page={data.page}
        pages={pages}
        href={href}
        labels={{
          prev: copy.prev,
          next: copy.next,
          page: fill(copy.page, { page: num(data.page), pages: num(pages) }),
        }}
      />
    </>
  );
}

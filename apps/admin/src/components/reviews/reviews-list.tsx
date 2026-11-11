import type { AdminReviewDto, AdminReviewsPageDto } from '@lummi/contracts';
import { formatPhone, plural, type Language } from '@lummi/i18n';
import { Download, Star } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { formatTashkent, num } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';
import { PublishButton } from './publish-button';
import { ReviewsFiltersForm, type ReviewFilters } from './reviews-filters';

function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className="size-4"
          strokeWidth={1.5}
          fill={n <= rating ? 'currentColor' : 'none'}
          aria-hidden
        />
      ))}
    </span>
  );
}

function ReviewCard({ r: review, t }: { r: AdminReviewDto; t: AdminMessages }) {
  const r = t.reviews;
  return (
    <li className="grid gap-3 px-4 py-4 @xl:px-5 @3xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Stars
            rating={review.rating}
            label={fill(r.ratingLabel, { rating: String(review.rating) })}
          />
          <Badge tone={review.published ? 'sage' : 'neutral'}>
            {review.published ? r.stateLabel.published : r.stateLabel.hidden}
          </Badge>
        </div>
        <MetaLine
          className="text-small text-muted-foreground tabular-nums"
          parts={[
            <span key="order" className="font-semibold whitespace-nowrap text-foreground">
              {fill(r.order, { number: String(review.orderNumber) })}
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
        {review.comment ? (
          <p className="text-pretty [overflow-wrap:anywhere] whitespace-pre-line">
            {review.comment}
          </p>
        ) : (
          <p className="text-muted-foreground">{r.noComment}</p>
        )}
        {review.photoIds.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {review.photoIds.map((id) => (
              <li key={id}>
                <a
                  href={`/api/admin/reviews/photos/${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block size-20 overflow-hidden rounded-button bg-field"
                >
                  <img
                    src={`/api/admin/reviews/photos/${id}`}
                    alt={r.photoAlt}
                    width={80}
                    height={80}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-small text-muted-foreground">
          {r.inOrder}: {review.items.join(', ')}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 @3xl:items-end">
        <PublishButton id={review.id} published={review.published} t={t} />
        {!review.published && <p className="text-[13px] text-muted-foreground">{r.checkHint}</p>}
        {review.publishedAt && (
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {fill(r.publishedAt, { date: formatTashkent(review.publishedAt) })}
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
  const r = t.reviews;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = Object.values(filters).some(Boolean);
  const href = (p: number) => listHref('/reviews', filters, p);
  const exportHref = `/api/admin/reviews/export${
    filtered ? `?${new URLSearchParams(filters as Record<string, string>)}` : ''
  }`;

  return (
    <>
      <PageHeader
        title={r.title}
        description={r.description}
        actions={
          <Button asChild variant="outline">
            <a href={exportHref} download>
              <Download strokeWidth={1.5} aria-hidden />
              {r.export}
            </a>
          </Button>
        }
      />

      <ReviewsFiltersForm t={t} filters={filters} />

      {data.items.length === 0 ? (
        <EmptyState
          title={filtered ? r.emptyFiltered : r.empty}
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/reviews">{r.filters.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {filtered ? r.emptyFilteredText : r.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <dl className="grid grid-cols-3 gap-3 border-b border-border px-4 py-3 text-small @xl:px-5">
            <div>
              <dt className="text-muted-foreground">{r.average}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                {data.average === null
                  ? r.averageNone
                  : data.average.toLocaleString(language === 'uz' ? 'uz-UZ' : 'ru-RU', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{r.publishedCount}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                {num(data.publishedCount)}
              </dd>
            </div>
            <div>
              <dt className="sr-only">{r.title}</dt>
              <dd className="mt-0.5 text-muted-foreground tabular-nums">
                {plural(language, data.total, r.total)}
              </dd>
            </div>
          </dl>
          <ul className="divide-y divide-border">
            {data.items.map((it) => (
              <ReviewCard key={it.id} r={it} t={t} />
            ))}
          </ul>
        </Card>
      )}

      <Pager
        page={data.page}
        pages={pages}
        href={href}
        labels={{
          prev: r.prev,
          next: r.next,
          page: fill(r.page, { page: num(data.page), pages: num(pages) }),
        }}
      />
    </>
  );
}

import { fill, formatDayMonth, plural } from '@lummi/i18n';
import { reviewsMessages } from '@lummi/i18n/reviews';
import type { PublicReview } from '@lummi/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, API_BASE, unwrap } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { Icon } from '../../ui/icons-core';
import { Skeleton } from '../../ui/Skeleton';

const STAR = 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8 6.9 19.5l1-5.7-4.1-4 5.7-.8z';

/** Five linear stars; the first `rating` are filled Graphite, the rest stay an outline. */
function Stars({ rating, size, label }: { rating: number; size: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex gap-0.5 text-ink">
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon
          key={n}
          d={STAR}
          size={size}
          fill={n <= Math.round(rating) ? 'currentColor' : 'none'}
          className={n <= Math.round(rating) ? undefined : 'text-faint'}
        />
      ))}
    </span>
  );
}

function ReviewItem({ review }: { review: PublicReview }) {
  const { language } = usePrefs();
  const t = reviewsMessages[language].reviews;
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="review">
      <div className="flex items-center justify-between gap-3">
        <span className="type-row min-w-0 truncate text-ink">{review.firstName}</span>
        <time dateTime={review.publishedAt} className="type-small shrink-0 text-muted">
          {formatDayMonth(review.publishedAt, language)}
        </time>
      </div>
      <Stars
        rating={review.rating}
        size={16}
        label={fill(t.ratingLabel, { rating: String(review.rating) })}
      />
      {review.comment ? (
        <p className="type-body text-pretty text-ink [overflow-wrap:anywhere]">{review.comment}</p>
      ) : null}
      {review.photos.length > 0 ? (
        <ul className="mt-1 flex gap-2">
          {review.photos.map((key) => (
            <li key={key} className="size-[72px] shrink-0 overflow-hidden rounded-btn bg-photo">
              <img
                src={`${API_BASE}/reviews/photos/${key}.jpg`}
                alt={t.photoAlt}
                width={72}
                height={72}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The reviews block under the notes of a fragrance or set card (#41, approved comp): the average
 * and count of the published reviews, then the latest few with their photos and first names, or
 * an empty state. It loads on its own, so the card never waits for it; a failed load leaves the
 * section out. Only published reviews ever reach this endpoint. `target` is a fragrance slug,
 * `discovery-set` or `builder-set`.
 */
export function ReviewsBlock({ target }: { target: string }) {
  const { language } = usePrefs();
  const t = reviewsMessages[language].reviews;
  const q = useQuery({
    queryKey: ['reviews', target],
    queryFn: async () => unwrap(await api.reviews.forTarget({ params: { target } }), 200),
    staleTime: 60_000,
  });
  if (q.isError) return null;
  return (
    <section aria-labelledby="reviews" className="mt-9" data-testid="reviews-block">
      <h2 id="reviews" className="type-section mb-3 text-ink">
        {t.title}
      </h2>
      {q.data === undefined ? (
        <div aria-busy="true" aria-label={t.loadingLabel}>
          <Skeleton rounded="card" className="h-[120px] w-full" />
        </div>
      ) : q.data.count === 0 ? (
        <div className="rounded-card bg-card px-4 py-5 text-center">
          <p className="type-row text-ink">{t.emptyTitle}</p>
          <p className="type-small mt-1 text-pretty text-muted">{t.emptyText}</p>
        </div>
      ) : (
        <div className="rounded-card bg-card px-4">
          <div className="flex items-center gap-3 border-b border-line py-4">
            <span
              className="text-[28px] leading-none font-semibold text-ink tabular-nums"
              data-testid="reviews-average"
            >
              {(q.data.average ?? 0).toLocaleString(language === 'uz' ? 'uz-UZ' : 'ru-RU', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </span>
            <div className="flex flex-col gap-1">
              <Stars
                rating={q.data.average ?? 0}
                size={18}
                label={fill(t.averageLabel, { rating: String(q.data.average) })}
              />
              <span className="type-small text-muted">
                {plural(language, q.data.count, t.count)}
              </span>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {q.data.items.map((r) => (
              <ReviewItem key={r.id} review={r} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

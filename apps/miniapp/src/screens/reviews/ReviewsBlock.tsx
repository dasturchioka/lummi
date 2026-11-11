import { formatAverage } from '../../lib/format';
import { fill, formatDayMonth, plural } from '@lummi/i18n';
import { reviewsMessages } from '@lummi/i18n/reviews';
import type { PublicReview } from '@lummi/contracts';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { api, API_BASE, unwrap } from '../../lib/api';
import { usePrefs } from '../../lib/prefs';
import { Icon } from '../../ui/icons-core';
import { Skeleton } from '../../ui/Skeleton';

/** The full-screen photo viewer: its own chunk, fetched on the first tap. */
const PhotoViewer = lazy(() => import('./PhotoViewer'));

const STAR = 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8 6.9 19.5l1-5.7-4.1-4 5.7-.8z';

/**
 * Five linear stars. `rating` may be fractional (the average): a star is filled by its share, so
 * 4.7 reads as four whole stars and 70 % of the fifth, never rounded up to five. An empty star is
 * an outline in Muted ink, which reads on Milk and on Graphite alike.
 */
function Stars({ rating, size, label }: { rating: number; size: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex gap-0.5 text-ink">
      {[1, 2, 3, 4, 5].map((n) => {
        const share = Math.min(1, Math.max(0, rating - (n - 1)));
        return (
          <span key={n} className="relative inline-flex" style={{ width: size, height: size }}>
            <Icon d={STAR} size={size} className="text-muted" />
            {share > 0 ? (
              <span
                className="absolute inset-y-0 left-0 overflow-hidden"
                style={{ width: `${share * 100}%` }}
              >
                <Icon d={STAR} size={size} fill="currentColor" />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** A comment of up to five lines; a longer one is clamped, with «Ещё» to read it all. */
function Comment({ text }: { text: string }) {
  const { language } = usePrefs();
  const t = reviewsMessages[language].reviews;
  const el = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const p = el.current;
    if (p && !open) setClamped(p.scrollHeight > p.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <p
        ref={el}
        className={`type-body text-pretty text-ink [overflow-wrap:anywhere] ${
          open ? '' : 'line-clamp-5'
        }`}
      >
        {text}
      </p>
      {clamped || open ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="type-small mt-1 font-semibold text-ink underline underline-offset-2"
        >
          {open ? t.less : t.more}
        </button>
      ) : null}
    </div>
  );
}

function ReviewItem({ review }: { review: PublicReview }) {
  const { language } = usePrefs();
  const t = reviewsMessages[language].reviews;
  const [viewing, setViewing] = useState<number | null>(null);
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
      {review.comment ? <Comment text={review.comment} /> : null}
      {review.photos.length > 0 ? (
        // one row that scrolls sideways, edge to edge inside the card, however many photos
        <ul className="-mx-4 mt-1 flex snap-x gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {review.photos.map((key, i) => (
            <li key={key} className="size-[72px] shrink-0 snap-start">
              <button
                type="button"
                aria-label={fill(t.photoOf, {
                  n: String(i + 1),
                  total: String(review.photos.length),
                })}
                onClick={() => setViewing(i)}
                className="size-full overflow-hidden rounded-btn bg-photo"
              >
                <img
                  src={`${API_BASE}/reviews/photos/${key}.jpg`}
                  alt={t.photoAlt}
                  width={72}
                  height={72}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {viewing !== null ? (
        <Suspense fallback={null}>
          <PhotoViewer keys={review.photos} start={viewing} onClose={() => setViewing(null)} />
        </Suspense>
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
              {formatAverage(q.data.average ?? 0)}
            </span>
            <div className="flex flex-col gap-1">
              <Stars
                rating={q.data.average ?? 0}
                size={18}
                label={fill(t.averageLabel, {
                  rating: formatAverage(q.data.average ?? 0),
                })}
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

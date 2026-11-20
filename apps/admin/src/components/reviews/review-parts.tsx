import type { AdminReviewDto } from '@lummi/contracts';
import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

/** Five stars, the first `rating` filled. */
export function Stars({ rating, label }: { rating: number; label: string }) {
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

/** «Опубликован», «Не опубликован», or «Пишется» while the shopper is still adding to it. */
export function StateBadge({ review, t }: { review: AdminReviewDto; t: AdminMessages }) {
  const labels = t.reviews.stateLabel;
  if (review.published) return <Badge tone="sage">{labels.published}</Badge>;
  return (
    <Badge tone={review.finished ? 'neutral' : 'live'}>
      {review.finished ? labels.hidden : labels.writing}
    </Badge>
  );
}

/**
 * What staff read of a review: its stars and state, the comment exactly as typed (a banned word
 * included: it is private until published) and the photos, served to staff whether published or not.
 */
export function ReviewBody({ review, t }: { review: AdminReviewDto; t: AdminMessages }) {
  const text = t.reviews;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars
          rating={review.rating}
          label={fill(text.ratingLabel, { rating: String(review.rating) })}
        />
        <StateBadge review={review} t={t} />
      </div>
      {review.comment ? (
        <p className="text-pretty [overflow-wrap:anywhere] whitespace-pre-line">{review.comment}</p>
      ) : (
        <p className="text-muted-foreground">{text.noComment}</p>
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
                  alt={text.photoAlt}
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
    </>
  );
}

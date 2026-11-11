import type { AdminReviewDto } from '@lummi/contracts';
import { MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { Section } from '@/components/ui/section';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { TEXT_LINK } from '@/lib/ui-classes';
import { ReviewBody } from './review-parts';

/** The order's review on its page (TZ §5): the rating, comment, photos and state, with the way to publish it. */
export function OrderReviewSection({
  review,
  t,
}: {
  review: AdminReviewDto | null;
  t: AdminMessages;
}) {
  if (!review) return null;
  const text = t.reviews;
  return (
    <Section
      title={text.orderTitle}
      action={<MessageSquareText className="size-[18px]" strokeWidth={1.5} aria-hidden />}
    >
      <div className="-mt-1 grid gap-2 text-sm">
        <ReviewBody review={review} t={t} />
        <time dateTime={review.createdAt} className="text-small text-muted-foreground tabular-nums">
          {formatTashkent(review.createdAt)}
        </time>
        <Link href={`/reviews?order=${review.orderNumber}`} className={TEXT_LINK}>
          {text.openInReviews}
        </Link>
      </div>
    </Section>
  );
}

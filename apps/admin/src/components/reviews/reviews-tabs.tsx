import Link from 'next/link';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** «Отзывы» and «Запросы отзывов» (the requests the bot made, with «не доставлено»): two views of one section. */
export function ReviewsTabs({ t, current }: { t: AdminMessages; current: 'reviews' | 'requests' }) {
  const items = [
    { key: 'reviews', href: '/reviews', label: t.reviews.tabs.reviews },
    { key: 'requests', href: '/reviews/requests', label: t.reviews.tabs.requests },
  ] as const;
  return (
    <nav aria-label={t.reviews.title} className="-mt-2 mb-5 flex gap-1 border-b border-border">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150',
            i.key === current
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

import { TabLinks } from '@/components/tab-links';
import type { AdminMessages } from '@/lib/i18n';

/** «Отзывы» and «Запросы отзывов» (the requests the bot made, with «не доставлено»): two views of one section. */
export function ReviewsTabs({ t, current }: { t: AdminMessages; current: 'reviews' | 'requests' }) {
  return (
    <TabLinks
      label={t.reviews.title}
      current={current}
      items={[
        { key: 'reviews', href: '/reviews', label: t.reviews.tabs.reviews },
        { key: 'requests', href: '/reviews/requests', label: t.reviews.tabs.requests },
      ]}
    />
  );
}

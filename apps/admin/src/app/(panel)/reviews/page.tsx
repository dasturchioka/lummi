import { ADMIN_REVIEWS_PAGE_SIZE, adminReviewsQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { ReviewsList } from '@/components/reviews/reviews-list';
import { getAdminMessages } from '@/lib/i18n';
import { clampPage, readFilters, readPage, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['rating', 'state', 'from', 'to'] as const;

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filters = readFilters(sp, adminReviewsQuerySchema.shape, KEYS);
  const page = readPage(sp);

  const api = await serverApi();
  const query = adminReviewsQuerySchema.parse({
    ...filters,
    page,
    pageSize: ADMIN_REVIEWS_PAGE_SIZE,
  });
  const list = await api.reviews.list({ query });
  if (list.status === 401) redirect('/login');
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (list.status !== 200) throw new Error(`reviews failed to load: ${list.status}`);
  clampPage('/reviews', filters, page, list.body.total, list.body.pageSize);
  const { language, t } = await getAdminMessages();
  return <ReviewsList t={t} language={language} data={list.body} filters={filters} />;
}

import { ADMIN_REVIEW_REQUESTS_PAGE_SIZE, adminReviewRequestsQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { RequestsList } from '@/components/reviews/requests-list';
import { getAdminMessages } from '@/lib/i18n';
import { clampPage, readFilters, readPage, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['state', 'from', 'to'] as const;

export default async function ReviewRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const filters = readFilters(sp, adminReviewRequestsQuerySchema.shape, KEYS);
  const page = readPage(sp);

  const api = await serverApi();
  const query = adminReviewRequestsQuerySchema.parse({
    ...filters,
    page,
    pageSize: ADMIN_REVIEW_REQUESTS_PAGE_SIZE,
  });
  const list = await api.reviews.requests({ query });
  if (list.status === 401) redirect('/login');
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (list.status !== 200) throw new Error(`review requests failed to load: ${list.status}`);
  clampPage('/reviews/requests', filters, page, list.body.total, list.body.pageSize);
  const { language, t } = await getAdminMessages();
  return <RequestsList t={t} language={language} data={list.body} filters={filters} />;
}

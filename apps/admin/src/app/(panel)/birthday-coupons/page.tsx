import { ADMIN_BIRTHDAY_PAGE_SIZE, adminBirthdayCouponsQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { BirthdayList } from '@/components/birthday/birthday-list';
import { getAdminMessages } from '@/lib/i18n';
import { clampPage, readFilters, readPage, type Search } from '@/lib/list-page';
import { serverApi } from '@/lib/server-api';

const KEYS = ['year', 'delivery', 'used'] as const;

export default async function BirthdayCouponsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const filters = readFilters(sp, adminBirthdayCouponsQuerySchema.shape, KEYS);
  const page = readPage(sp);

  const api = await serverApi();
  const query = adminBirthdayCouponsQuerySchema.parse({
    ...filters,
    page,
    pageSize: ADMIN_BIRTHDAY_PAGE_SIZE,
  });
  const list = await api.birthdayCoupons.list({ query });
  if (list.status === 401) redirect('/login');
  if (list.status === 403) redirect('/'); // the birthday coupons report is the owner's
  if (list.status !== 200) throw new Error(`birthday coupons failed to load: ${list.status}`);
  clampPage('/birthday-coupons', filters, page, list.body.total, list.body.pageSize);
  const { language, t } = await getAdminMessages();
  return <BirthdayList t={t} language={language} data={list.body} filters={filters} />;
}

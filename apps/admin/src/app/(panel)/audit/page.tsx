import { auditQuerySchema } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { AuditView, type AuditFilters } from '@/components/audit-view';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

const PAGE_SIZE = 25;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // Whatever the URL holds, only what the contract accepts reaches the API; the rest is dropped.
  const raw = {
    actor: one(sp.actor),
    action: one(sp.action),
    from: one(sp.from),
    to: one(sp.to),
  };
  const filters: AuditFilters = {};
  for (const key of ['actor', 'action', 'from', 'to'] as const) {
    const value = raw[key];
    if (value && auditQuerySchema.shape[key].safeParse(value).success) filters[key] = value;
  }
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? '1', 10) || 1);

  const api = await serverApi();
  const [list, options] = await Promise.all([
    api.audit.list({ query: { ...filters, page, pageSize: PAGE_SIZE } }),
    api.audit.filters(),
  ]);
  if (list.status === 401 || options.status === 401) redirect('/login');
  if (list.status !== 200 || options.status !== 200) redirect('/'); // 403: managers have no audit page
  const { t } = await getAdminMessages();
  return (
    <AuditView
      t={t}
      items={list.body.items}
      total={list.body.total}
      page={list.body.page}
      pageSize={list.body.pageSize}
      filters={filters}
      options={options.body}
    />
  );
}

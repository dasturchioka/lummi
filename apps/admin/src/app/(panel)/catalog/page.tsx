import { redirect } from 'next/navigation';
import { CatalogList } from '@/components/catalog/catalog-list';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const api = await serverApi();
  const type = one(sp.type);
  const visibility = one(sp.visibility);
  const flag = one(sp.flag);
  const familyId = Number(one(sp.familyId));
  const filters = {
    q: one(sp.q),
    type: type === 'homme' || type === 'femme' || type === 'unisex' ? type : undefined,
    familyId: Number.isInteger(familyId) && familyId > 0 ? familyId : undefined,
    visibility: visibility === 'visible' || visibility === 'hidden' ? visibility : undefined,
    flag: flag === 'hit' || flag === 'new' ? flag : undefined,
  } as const;
  const [list, families] = await Promise.all([
    api.catalog.fragrances.list({ query: filters }),
    api.catalog.families.list(),
  ]);
  if (list.status === 401) redirect('/login');
  if (list.status !== 200 || families.status !== 200) redirect('/'); // 403: owner only
  const { t, language } = await getAdminMessages();
  const filtered = Object.values(filters).some((v) => v !== undefined);
  return (
    <CatalogList
      items={list.body}
      families={families.body}
      filters={filters}
      filtered={filtered}
      language={language}
      t={t}
    />
  );
}

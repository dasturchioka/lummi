import { utcToTashkent } from '@lummi/contracts';
import { notFound, redirect } from 'next/navigation';
import { WarehouseView } from '@/components/warehouse/warehouse-view';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

/** A fragrance's warehouse page (#76): its oil, bottles, receipts, bottling and history. */
export default async function WarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const api = await serverApi();
  const res = await api.warehouse.get({ params: { id } });
  if (res.status === 401) redirect('/login');
  if (res.status === 404) notFound();
  if (res.status !== 200) throw new Error(`warehouse failed to load: ${res.status}`);
  const { t, language } = await getAdminMessages();
  const d = utcToTashkent(new Date());
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <WarehouseView
      data={res.body}
      today={`${d.year}-${pad(d.month)}-${pad(d.day)}`}
      language={language}
      t={t}
    />
  );
}

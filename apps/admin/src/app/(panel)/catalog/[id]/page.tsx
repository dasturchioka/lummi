import { notFound, redirect } from 'next/navigation';
import { FragranceForm } from '@/components/catalog/fragrance-form';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function EditFragrancePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const api = await serverApi();
  const [one, costs, families, notes, all] = await Promise.all([
    api.catalog.fragrances.get({ params: { id } }),
    api.catalog.fragrances.costs({ params: { id } }),
    api.catalog.families.list(),
    api.catalog.notes.list(),
    api.catalog.fragrances.list({ query: {} }),
  ]);
  if (one.status === 401) redirect('/login');
  if (one.status === 404) notFound();
  if (one.status !== 200 || families.status !== 200 || notes.status !== 200 || all.status !== 200)
    redirect('/');
  const { t, language } = await getAdminMessages();
  return (
    <FragranceForm
      key={one.body.id}
      initial={one.body}
      costs={costs.status === 200 ? costs.body : null}
      families={families.body}
      notes={notes.body}
      others={all.body.filter((f) => f.id !== id).map((f) => ({ id: f.id, name: f.name }))}
      language={language}
      t={t}
    />
  );
}

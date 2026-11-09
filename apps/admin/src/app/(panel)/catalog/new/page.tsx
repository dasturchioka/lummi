import { redirect } from 'next/navigation';
import { FragranceForm } from '@/components/catalog/fragrance-form';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function NewFragrancePage() {
  const api = await serverApi();
  const [families, notes, all] = await Promise.all([
    api.catalog.families.list(),
    api.catalog.notes.list(),
    api.catalog.fragrances.list({ query: {} }),
  ]);
  if (families.status === 401) redirect('/login');
  if (families.status !== 200 || notes.status !== 200 || all.status !== 200) redirect('/');
  const { t, language } = await getAdminMessages();
  return (
    <FragranceForm
      initial={null}
      families={families.body}
      notes={notes.body}
      others={all.body.map((f) => ({ id: f.id, name: f.name }))}
      language={language}
      t={t}
    />
  );
}

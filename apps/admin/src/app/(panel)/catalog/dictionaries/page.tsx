import { redirect } from 'next/navigation';
import { DictionaryManager } from '@/components/catalog/dictionary-manager';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function DictionariesPage() {
  const api = await serverApi();
  const [notes, families] = await Promise.all([
    api.catalog.notes.list(),
    api.catalog.families.list(),
  ]);
  if (notes.status === 401) redirect('/login');
  if (notes.status !== 200 || families.status !== 200) redirect('/');
  const { t, language } = await getAdminMessages();
  return (
    <DictionaryManager notes={notes.body} families={families.body} language={language} t={t} />
  );
}

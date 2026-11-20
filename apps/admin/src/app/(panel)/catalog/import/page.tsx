import { redirect } from 'next/navigation';
import { ExcelImport } from '@/components/catalog/excel-import';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function CatalogImportPage() {
  const api = await serverApi();
  const probe = await api.catalog.families.list(); // owner only, like the import routes
  if (probe.status === 401) redirect('/login');
  if (probe.status !== 200) redirect('/');
  const { t, language } = await getAdminMessages();
  return <ExcelImport language={language} t={t} />;
}

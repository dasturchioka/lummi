import { redirect } from 'next/navigation';
import { UzumImport } from '@/components/uzum/uzum-import';
import { getAdminMessages } from '@/lib/i18n';
import { getMe } from '@/lib/server-api';

/** Uzum sales from an Excel file (#80): owner and managers, like the sales page. */
export default async function UzumImportPage() {
  const me = await getMe();
  if (me.status === 401) redirect('/login');
  const { t, language } = await getAdminMessages();
  return <UzumImport language={language} t={t} />;
}

import { redirect } from 'next/navigation';
import { SettingsEditor } from '@/components/settings-editor';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function SettingsPage() {
  const api = await serverApi();
  const res = await api.settings.list();
  if (res.status === 401) redirect('/login');
  if (res.status === 403) redirect('/'); // managers have no settings page
  // anything else is a failed load: the panel's error state offers «Повторить»
  if (res.status !== 200) throw new Error(`settings failed to load: ${res.status}`);
  const { language, t } = await getAdminMessages();
  return <SettingsEditor states={res.body} language={language} t={t} />;
}

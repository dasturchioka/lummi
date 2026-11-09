import { redirect } from 'next/navigation';
import { StaffManager } from '@/components/staff-manager';
import { getAdminMessages } from '@/lib/i18n';
import { getMe, serverApi } from '@/lib/server-api';

export default async function StaffPage() {
  const api = await serverApi();
  const list = await api.admin.staff.list();
  if (list.status === 401) redirect('/login');
  if (list.status !== 200) redirect('/'); // 403: managers have no staff page
  const me = await getMe();
  const { t } = await getAdminMessages();
  return <StaffManager initial={list.body} meId={me.status === 200 ? me.body.id : 0} t={t} />;
}

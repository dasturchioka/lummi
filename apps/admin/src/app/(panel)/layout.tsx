import { redirect } from 'next/navigation';
import { PanelShell } from '@/components/shell/panel-shell';
import { getAdminMessages } from '@/lib/i18n';
import { getMe } from '@/lib/server-api';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (me.status !== 200) redirect('/login');
  // a temporary password: nothing but «Смените пароль» until it is changed (ADR 0038)
  if (me.body.mustChangePassword) redirect('/change-password');
  const { language, t } = await getAdminMessages();
  return (
    <PanelShell member={me.body} language={language} t={t}>
      {children}
    </PanelShell>
  );
}

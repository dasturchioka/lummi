import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LanguageSwitch } from '@/components/language-switch';
import { SignOutButton } from '@/components/sign-out-button';
import { Badge } from '@/components/ui/badge';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const api = await serverApi();
  const me = await api.admin.me();
  if (me.status !== 200) redirect('/login');
  const { language, t } = await getAdminMessages();
  const member = me.body;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-border py-5">
        <span className="title">{t.brand}</span>
        <nav className="flex gap-5 text-[15px] font-semibold">
          <Link href="/" className="hover:underline underline-offset-4">
            {t.nav.home}
          </Link>
          {member.role === 'owner' && (
            <Link href="/staff" className="hover:underline underline-offset-4">
              {t.nav.staff}
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm">
            {member.name} <Badge tone="sage">{t.roles[member.role]}</Badge>
          </span>
          <LanguageSwitch current={language} label={t.language} />
          <SignOutButton label={t.nav.signOut} />
        </div>
      </header>
      <main className="pt-8">{children}</main>
    </div>
  );
}

import { redirect } from 'next/navigation';
import { LanguageSwitch } from '@/components/language-switch';
import { LoginForm } from '@/components/login-form';
import { getAdminMessages } from '@/lib/i18n';
import { serverApi } from '@/lib/server-api';

export default async function LoginPage() {
  const api = await serverApi();
  if ((await api.admin.me()).status === 200) redirect('/');
  const { language, t } = await getAdminMessages();
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-6 px-4">
      <div className="flex items-center justify-between">
        <span className="title">{t.brand}</span>
        <LanguageSwitch current={language} label={t.language} />
      </div>
      <LoginForm
        t={t}
        botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME ?? ''}
        devLogin={process.env.NEXT_PUBLIC_ADMIN_DEV_LOGIN === 'true'}
      />
    </main>
  );
}

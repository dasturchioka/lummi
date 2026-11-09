import { redirect } from 'next/navigation';
import { LanguageSwitch } from '@/components/language-switch';
import { LoginForm } from '@/components/login-form';
import { Logo } from '@/components/logo';
import { getAdminMessages } from '@/lib/i18n';
import { getMe } from '@/lib/server-api';

export default async function LoginPage() {
  if ((await getMe()).status === 200) redirect('/');
  const { language, t } = await getAdminMessages();
  return (
    <main className="flex min-h-dvh flex-col px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-end py-4">
        <LanguageSwitch current={language} label={t.language} />
      </div>
      <div className="mx-auto grid w-full max-w-[400px] flex-1 content-center gap-8 pb-[12vh]">
        <Logo className="mx-auto h-5" />
        <LoginForm
          t={t}
          botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME ?? ''}
          devLogin={process.env.NEXT_PUBLIC_ADMIN_DEV_LOGIN === 'true'}
        />
      </div>
    </main>
  );
}

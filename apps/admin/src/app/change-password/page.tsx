import { settingDefinitions } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { ForcedPasswordChange } from '@/components/forced-password-change';
import { LanguageSwitch } from '@/components/language-switch';
import { Logo } from '@/components/logo';
import { getAdminMessages } from '@/lib/i18n';
import { getMe, serverApi } from '@/lib/server-api';

/**
 * «Смените пароль» (ADR 0038): where a member signed in with a temporary password lands, outside
 * the panel shell, with nothing else to open until the password is theirs.
 */
export default async function ChangePasswordPage() {
  const me = await getMe();
  if (me.status !== 200) redirect('/login');
  if (!me.body.mustChangePassword) redirect('/profile');
  const policy = await (await serverApi()).passwordPolicy();
  const { language, t } = await getAdminMessages();
  return (
    <main className="flex min-h-dvh flex-col px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-end py-4">
        <LanguageSwitch current={language} label={t.language} />
      </div>
      <div className="mx-auto grid w-full max-w-[400px] flex-1 content-center gap-8 pb-[12vh]">
        <Logo className="mx-auto h-5" />
        <ForcedPasswordChange
          t={t}
          language={language}
          name={me.body.name}
          login={me.body.login ?? ''}
          minLength={
            policy.status === 200
              ? policy.body.minLength
              : settingDefinitions['auth.passwordMinLength'].default
          }
        />
      </div>
    </main>
  );
}

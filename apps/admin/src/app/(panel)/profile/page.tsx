import { settingDefinitions } from '@lummi/contracts';
import { redirect } from 'next/navigation';
import { ProfileView } from '@/components/profile-view';
import { getAdminMessages } from '@/lib/i18n';
import { getMe, serverApi } from '@/lib/server-api';

/** Every staff member's own account (ADR 0038): the password and «Привязать Telegram». */
export default async function ProfilePage() {
  const me = await getMe();
  if (me.status !== 200) redirect('/login');
  const policy = await (await serverApi()).passwordPolicy();
  const { language, t } = await getAdminMessages();
  return (
    <ProfileView
      member={me.body}
      minLength={
        policy.status === 200
          ? policy.body.minLength
          : settingDefinitions['auth.passwordMinLength'].default
      }
      language={language}
      t={t}
    />
  );
}

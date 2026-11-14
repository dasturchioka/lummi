'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PasswordChangeForm } from '@/components/password-change-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';

/** The forced change after a temporary password (ADR 0038); sign-out is the only other way out. */
export function ForcedPasswordChange({
  t,
  language,
  name,
  login,
  minLength,
}: {
  t: AdminMessages;
  language: 'ru' | 'uz';
  name: string;
  login: string;
  minLength: number;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  return (
    <Card className="grid gap-6 p-6 sm:p-8">
      <div>
        <h1 className="title">{t.changePassword.title}</h1>
        <p className="mt-2 text-[13px] font-semibold [overflow-wrap:anywhere]">
          {name} · {login}
        </p>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">{t.changePassword.text}</p>
      </div>
      <PasswordChangeForm
        t={t}
        language={language}
        login={login}
        minLength={minLength}
        requireCurrent={false}
        submitLabel={t.changePassword.submit}
        onDone={() => {
          router.replace('/');
          router.refresh();
        }}
      />
      <Button
        variant="ghost"
        className="-mt-2 justify-self-center"
        loading={leaving}
        onClick={async () => {
          setLeaving(true);
          await browserApi.logout().catch(() => null);
          router.replace('/login');
          router.refresh();
        }}
      >
        {t.changePassword.signOut}
      </Button>
    </Card>
  );
}

'use client';

import type { LoginWidgetBody } from '@lummi/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';

declare global {
  interface Window {
    onLummiTelegramAuth?: (user: LoginWidgetBody) => void;
  }
}

export function LoginForm({
  t,
  botUsername,
  devLogin,
}: {
  t: AdminMessages;
  botUsername: string;
  devLogin: boolean;
}) {
  const router = useRouter();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [devId, setDevId] = useState('');

  const message = (status: number, code?: string) =>
    status === 403
      ? t.errors.noAccess
      : code === 'expired_login'
        ? t.errors.expiredLogin
        : status === 401
          ? t.errors.invalidLogin
          : t.errors.generic;

  useEffect(() => {
    if (!botUsername || !widgetRef.current) return;
    window.onLummiTelegramAuth = async (user) => {
      const res = await browserApi.admin.loginWidget({ body: user });
      if (res.status === 200) {
        router.replace('/');
        router.refresh();
      } else {
        setError(message(res.status, (res.body as { code?: string }).code));
      }
    };
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = 'large';
    script.dataset.radius = '10';
    script.dataset.onauth = 'onLummiTelegramAuth(user)';
    widgetRef.current.replaceChildren(script);
    return () => {
      delete window.onLummiTelegramAuth;
    };
  }, [botUsername]);

  return (
    <Card className="grid gap-5 p-6">
      <div>
        <h1 className="title">{t.login.title}</h1>
        <p className="mt-2 text-muted-foreground">{t.login.hint}</p>
      </div>
      {botUsername ? (
        <div ref={widgetRef} />
      ) : (
        !devLogin && <p className="text-sm text-muted-foreground">{t.login.widgetMissing}</p>
      )}
      {devLogin && (
        <form
          className="grid gap-2 border-t border-border pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const res = await browserApi.admin.devLogin({ body: { telegramId: Number(devId) } });
            if (res.status === 200) {
              router.replace('/');
              router.refresh();
            } else {
              setError(message(res.status));
            }
          }}
        >
          <p className="text-sm text-muted-foreground">{t.login.devHint}</p>
          <label className="grid gap-1 text-sm">
            {t.login.devTelegramId}
            <Input
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={devId}
              onChange={(e) => setDevId(e.target.value)}
            />
          </label>
          <Button type="submit">{t.login.devSubmit}</Button>
        </form>
      )}
      {error && (
        <div role="alert">
          <p className="font-semibold text-destructive">{error}</p>
          {error === t.errors.noAccess && (
            <p className="mt-1 text-sm text-muted-foreground">{t.errors.noAccessHint}</p>
          )}
        </div>
      )}
    </Card>
  );
}

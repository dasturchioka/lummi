'use client';

import type { LoginWidgetBody } from '@lummi/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
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
  const [pending, setPending] = useState(false);

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
      const res = await browserApi.loginWidget({ body: user });
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
    <Card className="grid gap-6 p-6 sm:p-8">
      <div>
        <h1 className="title">{t.login.title}</h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">{t.login.hint}</p>
      </div>
      {error && (
        <Notice
          title={error}
          icon={error === t.errors.noAccess ? 'blocked' : 'alert'}
          className="-mt-1"
        >
          {error === t.errors.noAccess ? t.errors.noAccessHint : undefined}
        </Notice>
      )}
      {botUsername ? (
        <div ref={widgetRef} className="min-h-10" />
      ) : (
        !devLogin && <Notice title={t.login.widgetMissing} />
      )}
      {devLogin && (
        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setPending(true);
            const res = await browserApi
              .devLogin({ body: { telegramId: Number(devId) } })
              .catch(() => null);
            if (res?.status === 200) {
              router.replace('/');
              router.refresh();
              return;
            }
            setPending(false);
            setError(res ? message(res.status) : t.errors.generic);
          }}
        >
          <div>
            <p className="text-[13px] font-semibold">{t.login.devTitle}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{t.login.devHint}</p>
          </div>
          <Field id="dev-telegram-id" label={t.login.devTelegramId}>
            <Input
              inputMode="numeric"
              pattern="[0-9]+"
              autoComplete="off"
              required
              value={devId}
              aria-invalid={error === t.errors.noAccess || undefined}
              onChange={(e) => setDevId(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={pending}>
            {t.login.devSubmit}
          </Button>
        </form>
      )}
    </Card>
  );
}

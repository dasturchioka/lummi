'use client';

import type { LoginWidgetBody } from '@lummi/contracts';
import { formatDateTime, formatDayMonth, formatTime, type Language } from '@lummi/i18n';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PasswordInput } from '@/components/password-fields';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

declare global {
  interface Window {
    onLummiTelegramAuth?: (user: LoginWidgetBody) => void;
  }
}

type Problem = { title: string; hint?: string; blocked?: boolean; credentials?: boolean };

/** Tashkent time, with the day when the lock ends on another day than now. */
function until(iso: string, language: Language) {
  const sameDay = formatDayMonth(iso, language) === formatDayMonth(new Date(), language);
  return sameDay ? formatTime(iso) : formatDateTime(iso, language);
}

/**
 * Sign-in (ADR 0038): login and password first, «Войти через Telegram» (the Login Widget) under
 * it. A wrong login and a wrong password read the same; a lock says until when.
 */
export function LoginForm({
  t,
  language,
  botUsername,
  devLogin,
}: {
  t: AdminMessages;
  language: Language;
  botUsername: string;
  devLogin: boolean;
}) {
  const router = useRouter();
  const widgetRef = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [devId, setDevId] = useState('');
  const [pending, setPending] = useState<'password' | 'dev' | null>(null);

  const enter = () => {
    router.replace('/');
    router.refresh();
  };

  /** The Login Widget and the dev path: a Telegram id that is not staff reads «Нет доступа». */
  const telegramProblem = (status: number, code?: string): Problem =>
    status === 403
      ? { title: t.errors.noAccess, hint: t.errors.noAccessHint, blocked: true }
      : code === 'expired_login'
        ? { title: t.errors.expiredLogin }
        : status === 401
          ? { title: t.errors.invalidLogin }
          : { title: t.errors.generic };

  useEffect(() => {
    if (!botUsername || !widgetRef.current) return;
    window.onLummiTelegramAuth = async (user) => {
      const res = await browserApi.loginWidget({ body: user }).catch(() => null);
      if (res?.status === 200) return enter();
      setProblem(
        res
          ? telegramProblem(res.status, (res.body as { code?: string }).code)
          : { title: t.errors.generic },
      );
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

  const signIn = async () => {
    setProblem(null);
    setPending('password');
    const res = await browserApi
      .passwordLogin({ body: { login: login.trim(), password } })
      .catch(() => null);
    if (res?.status === 200) return enter();
    setPending(null);
    setPassword('');
    if (res?.status === 401 || res?.status === 400) {
      setProblem({ title: t.errors.invalidCredentials, credentials: true });
    } else if (res?.status === 429) {
      setProblem({
        title: t.errors.locked,
        hint: fill(t.errors.lockedHint, { time: until(res.body.retryAt, language) }),
        blocked: true,
      });
    } else if (res?.status === 403) {
      setProblem({ title: t.errors.noAccess, hint: t.errors.accessOffHint, blocked: true });
    } else {
      setProblem({ title: t.errors.generic });
    }
  };

  return (
    <Card className="grid gap-6 p-6 sm:p-8">
      <div>
        <h1 className="title">{t.login.title}</h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">{t.login.hint}</p>
      </div>
      {problem && (
        <Notice
          title={problem.title}
          icon={problem.blocked ? 'blocked' : 'alert'}
          className="-mt-1"
        >
          {problem.hint}
        </Notice>
      )}
      {/* POST, so a submit before hydration never puts the password in a URL or a log */}
      <form
        method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void signIn();
        }}
      >
        <Field id="login" label={t.login.login}>
          <Input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            maxLength={64}
            value={login}
            aria-invalid={problem?.credentials || undefined}
            onChange={(e) => setLogin(e.target.value)}
          />
        </Field>
        <Field id="password" label={t.login.password}>
          <PasswordInput
            t={t}
            name="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            aria-invalid={problem?.credentials || undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" className="mt-1 w-full" loading={pending === 'password'}>
          {t.login.submit}
        </Button>
      </form>
      {botUsername && (
        <section aria-labelledby="telegram-sign-in" className="grid gap-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            {t.login.or}
            <span className="h-px flex-1 bg-border" />
          </div>
          <div>
            <h2 id="telegram-sign-in" className="text-[13px] font-semibold">
              {t.login.telegram}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{t.login.telegramHint}</p>
          </div>
          <div ref={widgetRef} className="min-h-10" />
        </section>
      )}
      {devLogin && (
        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setProblem(null);
            setPending('dev');
            const res = await browserApi
              .devLogin({ body: { telegramId: Number(devId) } })
              .catch(() => null);
            if (res?.status === 200) return enter();
            setPending(null);
            setProblem(res ? telegramProblem(res.status) : { title: t.errors.generic });
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
              onChange={(e) => setDevId(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" loading={pending === 'dev'}>
            {t.login.devSubmit}
          </Button>
        </form>
      )}
    </Card>
  );
}

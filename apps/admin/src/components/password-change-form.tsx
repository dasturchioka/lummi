'use client';

import type { StaffDto } from '@lummi/contracts';
import { formatDateTime, type Language } from '@lummi/i18n';
import { useState } from 'react';
import { PasswordInput } from '@/components/password-fields';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

type Errors = { current?: string; next?: string; repeat?: string; form?: string };

/**
 * New password, twice; the current one too unless the password in place is temporary (ADR 0038).
 * The length and the match are checked here first, the rest by the API. The login rides along in
 * a hidden field so a password manager files the new password under it.
 */
export function PasswordChangeForm({
  t,
  language,
  login,
  minLength,
  requireCurrent,
  submitLabel,
  onDone,
}: {
  t: AdminMessages;
  language: Language;
  login: string;
  minLength: number;
  requireCurrent: boolean;
  submitLabel: string;
  onDone: (member: StaffDto) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const weak = fill(t.errors.weakPassword, { min: String(minLength) });
  const p = requireCurrent ? t.profile : t.changePassword;

  const submit = async () => {
    const found: Errors = {};
    if (requireCurrent && !current) found.current = t.errors.wrongPassword;
    if (next.length < minLength) found.next = weak;
    else if (repeat !== next) found.repeat = t.password.mismatch;
    setErrors(found);
    if (Object.keys(found).length) return;
    setPending(true);
    const res = await browserApi
      .changePassword({
        body: { newPassword: next, ...(requireCurrent ? { currentPassword: current } : {}) },
      })
      .catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      setCurrent('');
      setNext('');
      setRepeat('');
      return onDone(res.body);
    }
    if (res?.status === 422) {
      const code = res.body.code;
      if (code === 'wrong_password') setErrors({ current: t.errors.wrongPassword });
      else if (code === 'same_password') setErrors({ next: t.errors.samePassword });
      else setErrors({ next: fill(t.errors.weakPassword, { min: String(res.body.minLength) }) });
    } else if (res?.status === 429) {
      setErrors({
        form: `${t.errors.locked}. ${fill(t.errors.lockedHint, { time: formatDateTime(res.body.retryAt, language) })}`,
      });
    } else setErrors({ form: t.errors.generic });
  };

  return (
    // POST, so a submit before hydration never puts a password in a URL or a log
    <form
      method="post"
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />
      {requireCurrent && (
        <Field id="current-password" label={t.profile.currentPassword} error={errors.current}>
          <PasswordInput
            t={t}
            autoComplete="current-password"
            required
            maxLength={128}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
      )}
      <Field
        id="new-password"
        label={p.newPassword}
        hint={fill(t.password.minLength, { min: String(minLength) })}
        error={errors.next}
      >
        <PasswordInput
          t={t}
          autoComplete="new-password"
          required
          maxLength={128}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      <Field id="repeat-password" label={p.repeat} error={errors.repeat}>
        <PasswordInput
          t={t}
          autoComplete="new-password"
          required
          maxLength={128}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </Field>
      {errors.form && <Notice title={errors.form} />}
      <Button type="submit" className="mt-1 sm:justify-self-start" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

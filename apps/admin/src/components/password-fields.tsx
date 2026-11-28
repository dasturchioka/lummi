'use client';

import { generatePassword, PASSWORD_MAX_LENGTH } from '@lummi/contracts';
import { Check, Copy, Eye, EyeOff, KeyRound } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

/** A temporary password from the browser's CSPRNG, unbiased (ADR 0038; the API checks the length). */
export const newTemporaryPassword = (minLength: number) =>
  generatePassword(minLength, (n) => crypto.getRandomValues(new Uint8Array(n)));

/**
 * A password field with a show / hide switch at its right end (a real button, after the field in
 * the tab order). Inside a `Field`: the id and hint wiring land on the input itself.
 */
export function PasswordInput({
  t,
  className,
  ...props
}: React.ComponentProps<'input'> & { t: AdminMessages }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn('pr-12', className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 text-muted-foreground hover:text-foreground"
        aria-label={shown ? t.password.hide : t.password.show}
        aria-pressed={shown}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? <EyeOff strokeWidth={1.5} aria-hidden /> : <Eye strokeWidth={1.5} aria-hidden />}
      </Button>
    </div>
  );
}

/** Copies `value` and says so for two seconds; a refused clipboard leaves the text selectable. */
export function CopyButton({
  value,
  t,
  className,
}: {
  value: string;
  t: AdminMessages;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* the value stays selectable in its field */
        }
      }}
    >
      {copied ? <Check strokeWidth={1.5} aria-hidden /> : <Copy strokeWidth={1.5} aria-hidden />}
      <span aria-live="polite">{copied ? t.password.copied : t.password.copy}</span>
    </Button>
  );
}

/**
 * A value to hand over (a login, a temporary password, a link): read-only, semibold with a little
 * tracking so characters stay apart, selected whole on focus, with its copy button.
 */
export function CopyField({
  id,
  label,
  value,
  t,
}: {
  id: string;
  label: string;
  value: string;
  t: AdminMessages;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-2 max-[359px]:flex-col">
        <Input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="font-semibold tracking-[0.04em] tabular-nums"
        />
        <CopyButton value={value} t={t} className="shrink-0" />
      </div>
    </div>
  );
}

/**
 * The login and temporary password the owner hands to a manager, shown once (ADR 0038): after
 * this view closes the panel cannot show the password again, only reset it.
 */
export function OneTimeCredentials({
  login,
  password,
  t,
}: {
  login: string;
  password: string;
  t: AdminMessages;
}) {
  return (
    <div className="grid gap-4">
      <CopyField id="handover-login" label={t.staff.login} value={login} t={t} />
      <CopyField id="handover-password" label={t.staff.password} value={password} t={t} />
      <div className="flex gap-3 rounded-button bg-field px-4 py-3.5">
        <KeyRound className="mt-px size-5 shrink-0" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0">
          <p className="leading-snug font-semibold">{t.password.shownOnce}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{t.password.shownOnceText}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * A new temporary password: generated on open, editable (the owner may type their own), with
 * «Сгенерировать» for another. Shown as text: the owner is about to hand it over. Its own label
 * and hint (a `Field` would put the id on the wrapper, not the input).
 */
export function TemporaryPasswordField({
  id,
  value,
  onChange,
  minLength,
  t,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  minLength: number;
  t: AdminMessages;
  error?: string;
}) {
  const hint = fill(t.staff.passwordHint, { min: String(minLength) });
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted-foreground">
        {t.staff.password}
      </label>
      <div className="flex gap-2 max-[359px]:flex-col">
        <Input
          id={id}
          required
          minLength={minLength}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value)}
          className="font-semibold tracking-[0.04em] tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => onChange(newTemporaryPassword(minLength))}
        >
          {t.password.generate}
        </Button>
      </div>
      <p
        id={`${id}-hint`}
        className={cn(
          'text-xs leading-snug',
          error ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

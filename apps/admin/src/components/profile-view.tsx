'use client';

import type { StaffDto, TelegramLinkDto } from '@lummi/contracts';
import { formatTime, type Language } from '@lummi/i18n';
import { Check, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProfilePhoto } from '@/components/profile-photo';
import { PageHeader } from '@/components/page-header';
import { CopyField } from '@/components/password-fields';
import { PasswordChangeForm } from '@/components/password-change-form';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

/** How often the open link asks whether the bot has bound it yet. */
const POLL_MS = 3000;

function Done({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-1.5 text-[13px] font-medium">
      <Check className="mt-0.5 size-4 shrink-0 text-sage-ink" strokeWidth={1.5} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * «Профиль» (ADR 0038): who is signed in, «Сменить пароль», and «Привязать Telegram». The link
 * waits here for the bot: the page asks every few seconds until the account is bound or the
 * link runs out, so the panel confirms what the bot said.
 */
export function ProfileView({
  member,
  minLength,
  language,
  t,
}: {
  member: StaffDto;
  minLength: number;
  language: Language;
  t: AdminMessages;
}) {
  const p = t.profile;
  const [changed, setChanged] = useState(false);
  return (
    <>
      <PageHeader title={p.title} description={p.description} />
      <div className="grid max-w-[640px] gap-4 sm:gap-6">
        <Section title={p.account}>
          <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-x-4">
            <dt className="text-muted-foreground">{p.name}</dt>
            <dd className="-mt-2.5 font-semibold [overflow-wrap:anywhere] sm:mt-0">
              {member.name}
            </dd>
            <dt className="text-muted-foreground">{p.role}</dt>
            <dd className="-mt-2.5 sm:mt-0">{t.roles[member.role]}</dd>
            <dt className="text-muted-foreground">{p.login}</dt>
            <dd className="-mt-2.5 [overflow-wrap:anywhere] sm:mt-0">
              {member.login ?? <span className="text-muted-foreground">{p.noLogin}</span>}
            </dd>
          </dl>
        </Section>

        <Section title={p.photoTitle}>
          <ProfilePhoto member={member} t={t} />
        </Section>

        <Section title={p.passwordTitle}>
          {member.login ? (
            <>
              {changed && <Done>{p.changed}</Done>}
              <PasswordChangeForm
                t={t}
                language={language}
                login={member.login}
                minLength={minLength}
                requireCurrent={member.hasPassword}
                submitLabel={p.submit}
                onDone={() => setChanged(true)}
              />
            </>
          ) : (
            <p className="text-sm text-pretty text-muted-foreground">
              {member.role === 'owner' ? p.noPasswordOwner : p.noPasswordManager}
            </p>
          )}
        </Section>

        <Section title={p.telegramTitle}>
          <TelegramLink member={member} t={t} />
        </Section>
      </div>
    </>
  );
}

function TelegramLink({ member, t }: { member: StaffDto; t: AdminMessages }) {
  const p = t.profile;
  const router = useRouter();
  const [telegramId, setTelegramId] = useState(member.telegramId);
  const [justLinked, setJustLinked] = useState(false);
  const [link, setLink] = useState<TelegramLinkDto | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // while a link is open: ask who we are until Telegram is bound, or the link runs out
  useEffect(() => {
    if (!link || expired || telegramId !== null) return;
    const ends = new Date(link.expiresAt).getTime();
    const timer = setInterval(async () => {
      if (Date.now() >= ends) {
        setExpired(true);
        return;
      }
      const res = await browserApi.me().catch(() => null);
      if (res?.status === 200 && res.body.telegramId !== null) {
        setTelegramId(res.body.telegramId);
        setJustLinked(true);
        setLink(null);
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [link, expired, telegramId, router]);

  const create = async () => {
    setPending(true);
    setError(null);
    const res = await browserApi.telegramLink().catch(() => null);
    setPending(false);
    if (res?.status === 201) {
      setLink(res.body);
      setExpired(false);
    } else if (res?.status === 409) router.refresh();
    else setError(t.errors.generic);
  };

  if (telegramId !== null) {
    return (
      <div className="grid gap-2">
        {justLinked ? (
          <Done>
            {p.linkDone}. {fill(p.linkDoneText, { id: String(telegramId) })}
          </Done>
        ) : (
          <p className="text-sm font-semibold tabular-nums">
            {fill(p.telegramLinked, { id: String(telegramId) })}
          </p>
        )}
        <p className="text-sm text-pretty text-muted-foreground">{p.telegramLinkedHint}</p>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-pretty text-muted-foreground">{p.telegramNone}</p>
        {error && <Notice title={error} />}
        <Button className="sm:justify-self-start" loading={pending} onClick={create}>
          {p.link}
        </Button>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="grid gap-4">
        <Notice title={p.linkExpired} />
        <Button className="sm:justify-self-start" loading={pending} onClick={create}>
          {p.linkAgain}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-pretty">{p.linkReady}</p>
      <CopyField id="telegram-link" label={p.linkLabel} value={link.url} t={t} />
      <p className="-mt-2 text-xs text-muted-foreground">
        {fill(p.linkExpires, { time: formatTime(link.expiresAt) })}
      </p>
      <Button asChild className="sm:justify-self-start">
        <a href={link.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink strokeWidth={1.5} aria-hidden />
          {p.linkOpen}
        </a>
      </Button>
      <p role="status" className="text-[13px] text-muted-foreground">
        {p.linkWaiting}
      </p>
    </div>
  );
}

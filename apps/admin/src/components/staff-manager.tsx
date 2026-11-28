'use client';

import { Avatar } from '@/components/avatar';
import { normalizeLogin, STAFF_LOGIN_PATTERN, type StaffDto } from '@lummi/contracts';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import {
  newTemporaryPassword,
  OneTimeCredentials,
  TemporaryPasswordField,
} from '@/components/password-fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { opensFor } from '@/lib/nav';
import { fill } from '@/lib/utils';

type Confirm = {
  kind: 'deactivate' | 'remove' | 'unlink' | 'toOwner' | 'toManager';
  member: StaffDto;
};
type ErrorText = (status: number, code?: string) => string;

/**
 * Owner-only staff page (ADR 0017, 0038): the list (a table on wide cards, a list below that)
 * with each member's role and what it opens. «Добавить сотрудника» (with a role choice) and
 * «Сбросить пароль» are dialogs that end on the login and temporary password shown once. A
 * confirmation comes before a manager is switched off, removed or loses their Telegram, and
 * before a role changes. Switching a manager back on needs no confirmation.
 */
export function StaffManager({
  initial,
  meId,
  minLength,
  t,
}: {
  initial: StaffDto[];
  meId: number;
  minLength: number;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  // each opening starts a fresh form (and a fresh password); nothing is generated before the first
  const [addKey, setAddKey] = useState(0);
  const [resetting, setResetting] = useState<StaffDto | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const codeText: Record<string, string> = {
    telegram_only: t.errors.telegramOnly,
    login_taken: t.errors.loginTaken,
    own_role: t.errors.ownRole,
    last_owner: t.errors.lastOwner,
    inactive: t.errors.inactiveMember,
  };
  const errorText: ErrorText = (status, code) =>
    (code && codeText[code]) ||
    (status === 409 ? t.errors.conflict : status === 403 ? t.errors.forbidden : t.errors.generic);

  const ask = (kind: Confirm['kind'], member: StaffDto) => {
    setRowError(null);
    setConfirm({ kind, member });
    setConfirmOpen(true);
  };

  const activate = async (member: StaffDto) => {
    setRowError(null);
    setBusyId(member.id);
    const res = await browserApi.staff
      .update({ params: { id: member.id }, body: { active: true } })
      .catch(() => null);
    setBusyId(null);
    if (res?.status === 200) router.refresh();
    else setRowError(res ? errorText(res.status) : t.errors.generic);
  };

  // Row actions are quiet text buttons. In the list they wrap after one another; in the table
  // they sit in two fixed columns (reset, switch | unlink, remove), each as wide as its longest
  // label, so every row's buttons line up. Outline and primary buttons are kept for the page
  // header and dialogs.
  const width = (...labels: string[]) =>
    `calc(${Math.max(...labels.map((l) => l.length))}ch + 1.5rem)`;
  const columns = `${width(t.staff.resetPassword, t.staff.deactivate, t.staff.activate)} ${width(t.staff.unlink, t.staff.remove)}`;
  const action = (label: string, onClick: () => void, loading = false) => (
    <Button variant="ghost" size="sm" className="justify-start" loading={loading} onClick={onClick}>
      {label}
    </Button>
  );
  const roleButton = (s: StaffDto) =>
    action(t.staff.changeRole, () => ask(s.role === 'owner' ? 'toManager' : 'toOwner', s));
  const actions = (s: StaffDto, table = false) => {
    if (s.id === meId) return null;
    // in the table «Сменить роль» sits under the name (it needs the room there), not in a column
    const changeRole = !table && roleButton(s);
    // the other actions are for managers; an owner is demoted first
    if (s.role !== 'manager') return changeRole || null;
    const reset = action(t.staff.resetPassword, () => {
      setRowError(null);
      setResetting(s);
    });
    const unlink =
      s.telegramId !== null && s.hasPassword
        ? action(t.staff.unlink, () => ask('unlink', s))
        : table && <span aria-hidden />;
    const toggle = s.active
      ? action(t.staff.deactivate, () => ask('deactivate', s))
      : action(t.staff.activate, () => activate(s), busyId === s.id);
    const remove = action(t.staff.remove, () => ask('remove', s));
    return (
      <>
        {reset}
        {unlink}
        {changeRole}
        {toggle}
        {remove}
      </>
    );
  };

  const status = (s: StaffDto) => (
    <Badge tone={s.active ? 'sage' : 'neutral'}>
      {s.active ? t.staff.active : t.staff.inactive}
    </Badge>
  );
  // a normal space before it, so a long name wraps without leaving an indented "(вы)" behind
  const you = (s: StaffDto) =>
    s.id === meId && (
      <>
        {' '}
        <span className="text-[12.5px] font-normal whitespace-nowrap text-muted-foreground">
          ({t.staff.you})
        </span>
      </>
    );
  const telegram = (s: StaffDto) =>
    s.telegramId === null
      ? `${t.staff.telegram} ${t.staff.telegramNone}`
      : `${t.staff.telegram} ${s.telegramId}`;
  const pending = (s: StaffDto) =>
    s.mustChangePassword && (
      <span className="text-[12.5px] text-muted-foreground">{t.staff.pendingPassword}</span>
    );

  return (
    <>
      <PageHeader
        title={t.staff.title}
        description={t.staff.description}
        actions={
          <Button
            onClick={() => {
              setAddKey((k) => k + 1);
              setAdding(true);
            }}
            className="max-sm:w-full"
          >
            <Plus strokeWidth={1.5} aria-hidden />
            {t.staff.add}
          </Button>
        }
      />

      {rowError && <Notice title={rowError} className="mb-4" />}

      {/*
        The layout follows the card's width, not the viewport (the sidebar takes 280 px from
        1024 up): a stacked list, actions on their own line, until the card reaches 896 px; a
        table from there, where every column has room.
      */}
      <Card className="@container">
        {initial.length === 0 ? (
          <EmptyState title={t.staff.empty} />
        ) : (
          <>
            <ul className="divide-y divide-border @4xl:hidden">
              {initial.map((s) => {
                const rowActions = actions(s);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-4 @xl:px-5"
                  >
                    <Avatar name={s.name} photo={s.photo} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold [overflow-wrap:anywhere]">
                        {s.name}
                        {you(s)}
                      </p>
                      <MetaLine
                        className="mt-0.5 text-[13px] text-muted-foreground"
                        parts={[t.roles[s.role], s.login ?? t.staff.noLogin, telegram(s)]}
                      />
                    </div>
                    <div className="shrink-0">{status(s)}</div>
                    {pending(s) && (
                      <div className="basis-full">
                        <p>{pending(s)}</p>
                      </div>
                    )}
                    {rowActions && (
                      <div className="-ml-3 flex basis-full flex-wrap gap-x-1.5">{rowActions}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="hidden @4xl:block">
              <Table>
                <THead>
                  <TR>
                    <TH>{t.staff.name}</TH>
                    <TH>{t.staff.signIn}</TH>
                    <TH>{t.staff.status}</TH>
                    <TH>
                      <span className="sr-only">{t.staff.actions}</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {initial.map((s) => (
                    <TR key={s.id}>
                      <TD className="min-w-64 [overflow-wrap:anywhere]">
                        <div className="flex items-start gap-3">
                          <Avatar name={s.name} photo={s.photo} />
                          <div className="min-w-0">
                            <p className="font-semibold">
                              {s.name}
                              {you(s)}
                            </p>
                            <p className="mt-0.5 text-[13px] text-muted-foreground">
                              {t.roles[s.role]}
                            </p>
                            {s.id !== meId && <div className="-ml-3 mt-1">{roleButton(s)}</div>}
                          </div>
                        </div>
                      </TD>
                      <TD className="min-w-40">
                        <p className="whitespace-nowrap">
                          {s.login ?? (
                            <span className="text-muted-foreground">{t.staff.noLogin}</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                          {telegram(s)}
                        </p>
                        {pending(s) && <p>{pending(s)}</p>}
                      </TD>
                      <TD>{status(s)}</TD>
                      <TD className="w-px">
                        <div className="grid gap-x-1.5" style={{ gridTemplateColumns: columns }}>
                          {actions(s, true)}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <Dialog open={adding} onOpenChange={setAdding}>
        {addKey > 0 && (
          <AddMemberContent
            key={addKey}
            t={t}
            minLength={minLength}
            errorText={errorText}
            onAdded={() => router.refresh()}
          />
        )}
      </Dialog>

      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        {resetting && (
          <ResetPasswordContent
            key={resetting.id}
            member={resetting}
            t={t}
            minLength={minLength}
            errorText={errorText}
            onReset={() => router.refresh()}
          />
        )}
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {confirm && (
          <ConfirmContent
            key={`${confirm.kind}-${confirm.member.id}`}
            confirm={confirm}
            t={t}
            errorText={errorText}
            onDone={() => {
              setConfirmOpen(false);
              router.refresh();
            }}
          />
        )}
      </AlertDialog>
    </>
  );
}

function ConfirmContent({
  confirm: { kind, member },
  t,
  errorText,
  onDone,
}: {
  confirm: Confirm;
  t: AdminMessages;
  errorText: ErrorText;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = {
    remove: { title: t.staff.removeTitle, text: t.staff.removeText, action: t.staff.remove },
    deactivate: {
      title: t.staff.deactivateTitle,
      text: t.staff.deactivateText,
      action: t.staff.deactivate,
    },
    unlink: { title: t.staff.unlinkTitle, text: t.staff.unlinkText, action: t.staff.unlink },
    toOwner: {
      title: t.staff.roleToOwnerTitle,
      text: t.staff.roleToOwnerText,
      action: t.staff.roleToOwner,
    },
    toManager: {
      title: t.staff.roleToManagerTitle,
      text: t.staff.roleToManagerText,
      action: t.staff.roleToManager,
    },
  }[kind];

  const run = async () => {
    setPending(true);
    setError(null);
    const params = { id: member.id };
    const calls = {
      remove: () => browserApi.staff.remove({ params }),
      unlink: () => browserApi.staff.unlinkTelegram({ params }),
      deactivate: () => browserApi.staff.update({ params, body: { active: false } }),
      toOwner: () => browserApi.staff.setRole({ params, body: { role: 'owner' } }),
      toManager: () => browserApi.staff.setRole({ params, body: { role: 'manager' } }),
    };
    const call = calls[kind]();
    const res = await call.catch(() => null);
    setPending(false);
    if (res?.status === 200) onDone();
    else
      setError(
        res ? errorText(res.status, (res.body as { code?: string }).code) : t.errors.generic,
      );
  };

  return (
    <AlertDialogContent>
      <AlertDialogTitle>{copy.title}</AlertDialogTitle>
      <AlertDialogDescription>{fill(copy.text, { name: member.name })}</AlertDialogDescription>
      {error && <Notice title={error} className="mt-4" />}
      <DialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="outline">{t.actions.cancel}</Button>
        </AlertDialogCancel>
        <Button loading={pending} onClick={run}>
          {copy.action}
        </Button>
      </DialogFooter>
    </AlertDialogContent>
  );
}

/** The handed-over login and password, then «Готово». */
function Handover({
  title,
  text,
  login,
  password,
  t,
}: {
  title: string;
  text: string;
  login: string;
  password: string;
  t: AdminMessages;
}) {
  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{text}</DialogDescription>
      <div className="mt-5">
        <OneTimeCredentials login={login} password={password} t={t} />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button>{t.staff.done}</Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

/** «Добавить сотрудника»: the form (role choice, a password already generated), then the handover. */
function AddMemberContent({
  t,
  minLength,
  errorText,
  onAdded,
}: {
  t: AdminMessages;
  minLength: number;
  errorText: ErrorText;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState(() => newTemporaryPassword(minLength));
  const [role, setRole] = useState<StaffDto['role']>('manager');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ login?: string; password?: string; form?: string }>({});
  const [added, setAdded] = useState<{ name: string; login: string; password: string } | null>(
    null,
  );

  const submit = async () => {
    const found: typeof errors = {};
    if (!STAFF_LOGIN_PATTERN.test(normalizeLogin(login))) found.login = t.staff.loginHint;
    if (password.length < minLength)
      found.password = fill(t.errors.weakPassword, { min: String(minLength) });
    setErrors(found);
    if (Object.keys(found).length) return;
    setPending(true);
    const res = await browserApi.staff
      .create({ body: { name, login: normalizeLogin(login), password, role } })
      .catch(() => null);
    setPending(false);
    if (res?.status === 201) {
      setAdded({ name: res.body.name, login: res.body.login ?? '', password });
      onAdded();
    } else if (res?.status === 409) setErrors({ login: t.errors.loginTaken });
    else if (res?.status === 422) {
      setErrors({ password: fill(t.errors.weakPassword, { min: String(res.body.minLength) }) });
    } else setErrors({ form: res ? errorText(res.status) : t.errors.generic });
  };

  return (
    <DialogContent>
      {added ? (
        <Handover
          title={t.staff.addedTitle}
          text={fill(t.staff.addedText, { name: added.name })}
          login={added.login}
          password={added.password}
          t={t}
        />
      ) : (
        <>
          <DialogTitle>{t.staff.addTitle}</DialogTitle>
          <DialogDescription className="sr-only">{t.staff.description}</DialogDescription>
          <form
            method="post"
            noValidate
            className="mt-5 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field id="staff-name" label={t.staff.name} hint={t.staff.nameHint}>
              <Input
                required
                maxLength={120}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              id="staff-login"
              label={t.staff.login}
              hint={t.staff.loginHint}
              error={errors.login}
            >
              <Input
                required
                maxLength={32}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
            </Field>
            <fieldset className="grid gap-1">
              <legend className="mb-1.5 text-[12.5px] font-medium text-muted-foreground">
                {t.staff.roleChoice}
              </legend>
              {(['manager', 'owner'] as const).map((r) => (
                <label
                  key={r}
                  className="-mx-2.5 flex cursor-pointer touch-manipulation items-start gap-3 rounded-button px-2.5 py-2 transition-colors duration-150 select-none hover:bg-milk active:bg-field"
                >
                  <input
                    type="radio"
                    name="staff-role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="mt-0.5 size-[18px] shrink-0 accent-graphite"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{t.roles[r]}</span>
                    <span className="block text-[13px] text-pretty text-muted-foreground">
                      {opensFor(r, t)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <TemporaryPasswordField
              id="staff-password"
              value={password}
              onChange={setPassword}
              minLength={minLength}
              t={t}
              error={errors.password}
            />
            {errors.form && <Notice title={errors.form} />}
            <DialogFooter className="mt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t.actions.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" loading={pending} disabled={!name.trim()}>
                {t.staff.addSubmit}
              </Button>
            </DialogFooter>
          </form>
        </>
      )}
    </DialogContent>
  );
}

function ResetPasswordContent({
  member,
  t,
  minLength,
  errorText,
  onReset,
}: {
  member: StaffDto;
  t: AdminMessages;
  minLength: number;
  errorText: ErrorText;
  onReset: () => void;
}) {
  const needsLogin = member.login === null;
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState(() => newTemporaryPassword(minLength));
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ login?: string; password?: string; form?: string }>({});
  const [done, setDone] = useState<{ login: string; password: string } | null>(null);

  const submit = async () => {
    const found: typeof errors = {};
    if (needsLogin && !STAFF_LOGIN_PATTERN.test(normalizeLogin(login)))
      found.login = t.staff.loginHint;
    if (password.length < minLength)
      found.password = fill(t.errors.weakPassword, { min: String(minLength) });
    setErrors(found);
    if (Object.keys(found).length) return;
    setPending(true);
    const res = await browserApi.staff
      .resetPassword({
        params: { id: member.id },
        body: { password, ...(needsLogin ? { login: normalizeLogin(login) } : {}) },
      })
      .catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      setDone({ login: res.body.login ?? '', password });
      onReset();
      return;
    }
    const code = res ? (res.body as { code?: string }).code : undefined;
    if (code === 'login_taken') setErrors({ login: t.errors.loginTaken });
    else if (code === 'weak_password' && res?.status === 422 && 'minLength' in res.body) {
      setErrors({ password: fill(t.errors.weakPassword, { min: String(res.body.minLength) }) });
    } else setErrors({ form: res ? errorText(res.status, code) : t.errors.generic });
  };

  return (
    <DialogContent>
      {done ? (
        <Handover
          title={t.staff.resetDoneTitle}
          text={fill(t.staff.resetDoneText, { name: member.name })}
          login={done.login}
          password={done.password}
          t={t}
        />
      ) : (
        <>
          <DialogTitle>{t.staff.resetTitle}</DialogTitle>
          <DialogDescription>
            {fill(t.staff.resetText, { name: member.name })}
            {needsLogin && (
              <span className="mt-1.5 block">
                {fill(t.staff.resetLoginText, { name: member.name })}
              </span>
            )}
          </DialogDescription>
          <form
            method="post"
            noValidate
            className="mt-5 grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {needsLogin && (
              <Field
                id="reset-login"
                label={t.staff.login}
                hint={t.staff.loginHint}
                error={errors.login}
              >
                <Input
                  required
                  maxLength={32}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </Field>
            )}
            <TemporaryPasswordField
              id="reset-password"
              value={password}
              onChange={setPassword}
              minLength={minLength}
              t={t}
              error={errors.password}
            />
            {errors.form && <Notice title={errors.form} />}
            <DialogFooter className="mt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t.actions.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" loading={pending}>
                {t.staff.resetSubmit}
              </Button>
            </DialogFooter>
          </form>
        </>
      )}
    </DialogContent>
  );
}

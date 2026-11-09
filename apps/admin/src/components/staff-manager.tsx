'use client';

import type { StaffDto } from '@lummi/contracts';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
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
import { Notice } from '@/components/ui/notice';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

type Confirm = { kind: 'deactivate' | 'remove'; member: StaffDto };

/**
 * Owner-only staff page: the list (a table on wide cards, a list below that), «Добавить
 * менеджера» in a dialog, and a confirmation before a manager is switched off or removed.
 * Switching a manager back on needs no confirmation.
 */
export function StaffManager({
  initial,
  meId,
  t,
}: {
  initial: StaffDto[];
  meId: number;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const errorText = (status: number) =>
    status === 409 ? t.errors.conflict : status === 403 ? t.errors.forbidden : t.errors.generic;

  const ask = (kind: Confirm['kind'], member: StaffDto) => {
    setRowError(null);
    setConfirm({ kind, member });
    setConfirmOpen(true);
  };

  const activate = async (member: StaffDto) => {
    setRowError(null);
    setBusyId(member.id);
    const res = await browserApi.admin.staff
      .update({ params: { id: member.id }, body: { active: true } })
      .catch(() => null);
    setBusyId(null);
    if (res?.status === 200) router.refresh();
    else setRowError(res ? errorText(res.status) : t.errors.generic);
  };

  const actions = (s: StaffDto) =>
    s.role === 'manager' && s.id !== meId ? (
      <>
        {s.active ? (
          <Button variant="outline" size="sm" onClick={() => ask('deactivate', s)}>
            {t.staff.deactivate}
          </Button>
        ) : (
          <Button variant="outline" size="sm" loading={busyId === s.id} onClick={() => activate(s)}>
            {t.staff.activate}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => ask('remove', s)}>
          {t.staff.remove}
        </Button>
      </>
    ) : null;

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

  return (
    <>
      <PageHeader
        title={t.staff.title}
        description={t.staff.description}
        actions={
          <Button onClick={() => setAdding(true)} className="max-sm:w-full">
            <Plus strokeWidth={1.5} aria-hidden />
            {t.staff.add}
          </Button>
        }
      />

      {rowError && <Notice title={rowError} className="mb-4" />}

      {/*
        The layout follows the card's width, not the viewport (the sidebar takes 256 px from
        1024 up): a stacked list when narrow, one line per person from 576 px, a table from
        896 px, where every column has room.
      */}
      <Card className="@container">
        {initial.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t.staff.empty}</p>
        ) : (
          <>
            <ul className="divide-y divide-border @4xl:hidden">
              {initial.map((s) => {
                const rowActions = actions(s);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-start gap-3 px-4 py-4 @xl:flex-nowrap @xl:items-center @xl:gap-4 @xl:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold [overflow-wrap:anywhere]">
                        {s.name}
                        {you(s)}
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                        {t.roles[s.role]} · {s.telegramId}
                      </p>
                    </div>
                    <div className="shrink-0">{status(s)}</div>
                    {/* a fixed slot from 576 px keeps the status pills in one column */}
                    <div
                      className={cn(
                        'flex basis-full flex-wrap gap-2 @xl:w-[17.5rem] @xl:shrink-0 @xl:basis-auto @xl:justify-end @xl:gap-1.5',
                        !rowActions && '@max-xl:hidden',
                      )}
                    >
                      {rowActions}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden @4xl:block">
              <Table>
                <THead>
                  <TR>
                    <TH>{t.staff.name}</TH>
                    <TH>{t.staff.telegramId}</TH>
                    <TH>{t.staff.role}</TH>
                    <TH>{t.staff.status}</TH>
                    <TH>
                      <span className="sr-only">{t.staff.actions}</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {initial.map((s) => (
                    <TR key={s.id}>
                      <TD className="font-semibold [overflow-wrap:anywhere]">
                        {s.name}
                        {you(s)}
                      </TD>
                      <TD className="whitespace-nowrap">{s.telegramId}</TD>
                      <TD className="whitespace-nowrap">{t.roles[s.role]}</TD>
                      <TD>{status(s)}</TD>
                      <TD className="w-px">
                        <div className="flex justify-end gap-1.5">{actions(s)}</div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <AddManagerDialog
        open={adding}
        onOpenChange={setAdding}
        t={t}
        errorText={errorText}
        onAdded={() => router.refresh()}
      />

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
  errorText: (status: number) => string;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy =
    kind === 'remove'
      ? { title: t.staff.removeTitle, text: t.staff.removeText, action: t.staff.remove }
      : {
          title: t.staff.deactivateTitle,
          text: t.staff.deactivateText,
          action: t.staff.deactivate,
        };

  const run = async () => {
    setPending(true);
    setError(null);
    const call =
      kind === 'remove'
        ? browserApi.admin.staff.remove({ params: { id: member.id } })
        : browserApi.admin.staff.update({ params: { id: member.id }, body: { active: false } });
    const res = await call.catch(() => null);
    setPending(false);
    if (res?.status === 200) onDone();
    else setError(res ? errorText(res.status) : t.errors.generic);
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

function AddManagerDialog({
  open,
  onOpenChange,
  t,
  errorText,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: AdminMessages;
  errorText: (status: number) => string;
  onAdded: () => void;
}) {
  const [telegramId, setTelegramId] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: boolean) => {
    if (!next) setError(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogTitle>{t.staff.addTitle}</DialogTitle>
        <DialogDescription className="sr-only">{t.staff.description}</DialogDescription>
        <form
          className="mt-5 grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            const res = await browserApi.admin.staff
              .create({ body: { telegramId: Number(telegramId), name } })
              .catch(() => null);
            setPending(false);
            if (res?.status === 201) {
              setTelegramId('');
              setName('');
              onOpenChange(false);
              onAdded();
            } else {
              setError(res ? errorText(res.status) : t.errors.generic);
            }
          }}
        >
          <Field id="staff-telegram-id" label={t.staff.telegramId} hint={t.staff.telegramIdHint}>
            <Input
              inputMode="numeric"
              pattern="[0-9]+"
              autoComplete="off"
              required
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
            />
          </Field>
          <Field id="staff-name" label={t.staff.name} hint={t.staff.nameHint}>
            <Input
              required
              maxLength={120}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {error && <Notice title={error} />}
          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t.actions.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {t.staff.addSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

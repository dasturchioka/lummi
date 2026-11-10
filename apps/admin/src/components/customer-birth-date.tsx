'use client';

import { formatCalendarDate, type Language } from '@lummi/i18n';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
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
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { QUIET_ACTION } from '@/lib/ui-classes';

/**
 * The customer's date of birth on their page, with «Исправить» (TZ §3.8: the customer enters it
 * once; only staff change it). The API audits the old and new date.
 */
export function CustomerBirthDate({
  id,
  birthDate,
  language,
  t,
}: {
  id: number;
  birthDate: string | null;
  language: Language;
  t: AdminMessages;
}) {
  const c = t.customers;
  const [open, setOpen] = useState(false);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      {birthDate ? (
        <span data-testid="birth-date">{formatCalendarDate(birthDate, language, true)}</span>
      ) : (
        <span className="font-normal text-muted-foreground">{c.noBirthDate}</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className={`${QUIET_ACTION} -my-1 h-auto px-1 py-0.5`}
        onClick={() => setOpen(true)}
        data-testid="birth-date-edit"
      >
        {c.birthDateEdit}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {open && (
            <BirthDateForm id={id} initial={birthDate} t={t} onSaved={() => setOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}

function BirthDateForm({
  id,
  initial,
  t,
  onSaved,
}: {
  id: number;
  initial: string | null;
  t: AdminMessages;
  onSaved: () => void;
}) {
  const router = useRouter();
  const c = t.customers;
  const [value, setValue] = useState(initial ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <DialogTitle>{c.birthDateTitle}</DialogTitle>
      <DialogDescription>{c.birthDateText}</DialogDescription>
      <form
        className="mt-5 grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value) return;
          setPending(true);
          setError(null);
          const res = await browserApi.customers
            .setBirthDate({ params: { id }, body: { birthDate: value } })
            .catch(() => null);
          setPending(false);
          if (res?.status === 200) {
            onSaved();
            router.refresh();
          } else
            setError(
              res?.status === 422 || res?.status === 400 ? c.birthDateInvalid : t.errors.generic,
            );
        }}
      >
        <Field id="birth-date-value" label={c.birthDate}>
          <Input
            type="date"
            required
            min="1900-01-01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {error && <Notice title={error} />}
        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.actions.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending} disabled={!value}>
            {c.birthDateSave}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

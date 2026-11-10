'use client';

import {
  SHOP_CARD_DIGITS,
  groupCardNumber,
  shopCardInputSchema,
  type AdminShopCardDto,
} from '@lummi/contracts';
import { CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
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
import { Section } from '@/components/ui/section';
import { browserApi } from '@/lib/api';
import { luhnValid } from '@/lib/card';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';

type Card = NonNullable<AdminShopCardDto['card']>;
type FieldName = 'number' | 'holder';

const digitsOf = (s: string) => s.replace(/\D/g, '');

/**
 * Owner-only «Карта для оплаты» (#28): the card shoppers transfer to, as the payment screen shows
 * it, with «Изменить» and «Убрать карту». A change goes through a second step that shows the
 * number grouped in fours to check digit by digit (a typo sends payments to a stranger); a failed
 * check digit is said there, but does not block the save. Without a card checkout is closed, and
 * the page says so. The API audits every change with the number masked.
 */
export function ShopCardEditor({ card, t }: { card: AdminShopCardDto['card']; t: AdminMessages }) {
  const s = t.shopCard;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const done = () => {
    setEditing(false);
    setRemoving(false);
    router.refresh();
  };

  return (
    <>
      <PageHeader title={s.title} description={s.description} />

      {card ? (
        <Section title={s.current} className="max-w-2xl">
          <div className="grid gap-1" data-testid="shop-card">
            <p className="text-[22px] leading-tight font-semibold tracking-[0.04em] whitespace-nowrap tabular-nums max-[359px]:text-[19px]">
              {groupCardNumber(card.number)}
            </p>
            <p className="text-[15px] [overflow-wrap:anywhere]">{card.holder}</p>
            <p className="mt-1 text-small text-muted-foreground tabular-nums">
              {fill(s.updatedAt, { at: formatTashkent(card.updatedAt) })}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setEditing(true)}>
              {s.edit}
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              {s.remove}
            </Button>
          </div>
        </Section>
      ) : (
        <EmptyState
          title={s.noneTitle}
          action={<Button onClick={() => setEditing(true)}>{s.set}</Button>}
        >
          {s.noneText}
        </EmptyState>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        {/* remounted per opening, so a closed dialog starts again from the card as it is */}
        {editing && <EditCard card={card} t={t} onSaved={done} />}
      </Dialog>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        {removing && <RemoveCard t={t} onRemoved={done} />}
      </AlertDialog>
    </>
  );
}

function EditCard({
  card,
  t,
  onSaved,
}: {
  card: Card | null;
  t: AdminMessages;
  onSaved: () => void;
}) {
  const s = t.shopCard;
  const [number, setNumber] = useState(card ? groupCardNumber(card.number) : '');
  const [holder, setHolder] = useState(card?.holder ?? '');
  const [invalid, setInvalid] = useState<FieldName[]>([]);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = shopCardInputSchema.safeParse({ number, holder });
  const typed = digitsOf(number).length;

  const next = () => {
    if (!parsed.success) {
      setInvalid([...new Set(parsed.error.issues.map((i) => i.path[0] as FieldName))]);
      return;
    }
    setInvalid([]);
    setError(null);
    setStep('confirm');
  };

  const save = async () => {
    if (!parsed.success) return;
    setPending(true);
    setError(null);
    const res = await browserApi.shopCard.set({ body: parsed.data }).catch(() => null);
    setPending(false);
    if (res?.status === 200) onSaved();
    else if (res?.status === 400) {
      // the server reads the card as the form does; should they ever differ, back to the fields
      setInvalid(res.body.fields);
      setStep('form');
    } else setError(res?.status === 403 ? t.errors.forbidden : t.errors.generic);
  };

  if (step === 'confirm' && parsed.success) {
    const valid = luhnValid(parsed.data.number);
    return (
      <DialogContent>
        <DialogTitle>{s.confirmTitle}</DialogTitle>
        <DialogDescription>{s.confirmText}</DialogDescription>
        <div className="mt-5 grid gap-1 rounded-button bg-field px-4 py-3.5">
          <p
            className="text-[22px] leading-tight font-semibold tracking-[0.04em] whitespace-nowrap tabular-nums max-[359px]:text-[19px]"
            data-testid="confirm-number"
          >
            {groupCardNumber(parsed.data.number)}
          </p>
          <p className="text-[15px] [overflow-wrap:anywhere]">{parsed.data.holder}</p>
        </div>
        {!valid && (
          <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-snug font-medium">
            <CircleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {s.checksum}
          </p>
        )}
        {error && <Notice title={error} className="mt-4" />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setStep('form')} disabled={pending}>
            {s.back}
          </Button>
          <Button loading={pending} onClick={save}>
            {s.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <DialogTitle>{s.editTitle}</DialogTitle>
      <DialogDescription className="sr-only">{s.description}</DialogDescription>
      <form
        className="mt-5 grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <Field
          id="shop-card-number"
          label={s.number}
          hint={s.numberHint}
          error={invalid.includes('number') ? s.invalidNumber : undefined}
          aside={
            <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
              {typed}/{SHOP_CARD_DIGITS}
            </span>
          }
        >
          <Input
            value={number}
            maxLength={40}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            className="tabular-nums"
            onChange={(e) => setNumber(e.target.value)}
          />
        </Field>
        <Field
          id="shop-card-holder"
          label={s.holder}
          hint={s.holderHint}
          error={invalid.includes('holder') ? s.invalidHolder : undefined}
        >
          <Input
            value={holder}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(e) => setHolder(e.target.value)}
          />
        </Field>
        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.actions.cancel}
            </Button>
          </DialogClose>
          <Button type="submit">{s.next}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function RemoveCard({ t, onRemoved }: { t: AdminMessages; onRemoved: () => void }) {
  const s = t.shopCard;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setPending(true);
    setError(null);
    const res = await browserApi.shopCard.clear().catch(() => null);
    setPending(false);
    if (res?.status === 200) onRemoved();
    else setError(res?.status === 403 ? t.errors.forbidden : t.errors.generic);
  };
  return (
    <AlertDialogContent>
      <AlertDialogTitle>{s.removeTitle}</AlertDialogTitle>
      <AlertDialogDescription>{s.removeText}</AlertDialogDescription>
      {error && <Notice title={error} className="mt-4" />}
      <DialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="outline">{t.actions.cancel}</Button>
        </AlertDialogCancel>
        <Button loading={pending} onClick={remove}>
          {s.remove}
        </Button>
      </DialogFooter>
    </AlertDialogContent>
  );
}

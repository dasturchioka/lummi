'use client';

import {
  PROMO_KINDS,
  promoCodeInputSchema,
  type AdminPromoCode,
  type PromoCodeInput,
  type PromoKind,
} from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { ArrowLeft, Check, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { num } from '@/components/broadcasts/format';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';
import { discountOf } from './terms';

/** The form as typed: numbers stay text until the save, so a half-typed one is never rewritten. */
interface Draft {
  code: string;
  kind: PromoKind;
  percent: string;
  amount: string;
  maxDiscount: string;
  expiresOn: string;
  minOrderTotal: string;
  totalLimit: string;
  perCustomerLimit: string;
  newCustomersOnly: boolean;
  appliesToMarkedDown: boolean;
  active: boolean;
}
type NumberField =
  'percent' | 'amount' | 'maxDiscount' | 'minOrderTotal' | 'totalLimit' | 'perCustomerLimit';

const text = (n: number | null) => (n === null ? '' : String(n));

function toDraft(p: AdminPromoCode | null): Draft {
  return {
    code: p?.code ?? '',
    kind: p?.kind ?? 'percent',
    percent: text(p?.percent ?? null),
    amount: text(p?.amount ?? null),
    maxDiscount: text(p?.maxDiscount ?? null),
    expiresOn: p?.expiresOn ?? '',
    minOrderTotal: text(p?.minOrderTotal ?? null),
    totalLimit: text(p?.totalLimit ?? null),
    perCustomerLimit: text(p?.perCustomerLimit ?? null),
    newCustomersOnly: p?.newCustomersOnly ?? false,
    appliesToMarkedDown: p?.appliesToMarkedDown ?? false,
    active: p?.active ?? true,
  };
}

/** Blank is «none»; spaces typed as thousands separators (any kind, `\s`) are dropped; the schema checks the rest. */
const number = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\s/g, '')));

/** The body the API takes; the fields of the other kind are sent empty, as the schema asks. */
function toInput(d: Draft): PromoCodeInput {
  const percent = d.kind === 'percent';
  return {
    code: d.code,
    kind: d.kind,
    percent: percent ? number(d.percent) : null,
    amount: percent ? null : number(d.amount),
    maxDiscount: percent ? number(d.maxDiscount) : null,
    expiresOn: d.expiresOn === '' ? null : d.expiresOn,
    minOrderTotal: number(d.minOrderTotal),
    totalLimit: number(d.totalLimit),
    perCustomerLimit: number(d.perCustomerLimit),
    newCustomersOnly: d.newCustomersOnly,
    appliesToMarkedDown: d.appliesToMarkedDown,
    active: d.active,
  };
}

/** A typed amount read back with its thousands («30000» -> «30 000 сум»), once it has some. */
function moneyEcho(s: string, language: Language): string | undefined {
  const n = number(s);
  return n !== null && Number.isSafeInteger(n) && n >= 1000 ? formatMoney(n, language) : undefined;
}

/**
 * Create and edit a promo code: the code and its discount, the conditions, the limits and the
 * switches. The API's own schema (shared via contracts) checks the form before the save; the
 * server checks it again. A code no order took can be deleted; a used one only switched off.
 */
export function PromoForm({
  initial,
  language,
  t,
}: {
  initial: AdminPromoCode | null;
  language: Language;
  t: AdminMessages;
}) {
  const m = t.promo;
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _gone, ...rest }) => rest);
  };

  const messageFor = (field: string, code: string | undefined) => {
    if (field === 'code') return code === 'required' ? m.errors.required : m.errors.codeFormat;
    if (code === 'required') return m.errors.required;
    return field === 'percent' ? m.errors.percent : m.errors.number;
  };

  const save = async () => {
    setBanner(null);
    const parsed = promoCodeInputSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        // an empty code fails its pattern: say it is missing, not malformed
        const code = field === 'code' && draft.code.trim() === '' ? 'required' : issue.message;
        found[field] ??= messageFor(field, code);
      }
      setErrors(found);
      setBanner({ kind: 'error', text: m.fixErrors });
      return;
    }
    setErrors({});
    setPending(true);
    const res = await (
      saved
        ? browserApi.promoCodes.update({ params: { id: saved.id }, body: parsed.data })
        : browserApi.promoCodes.create({ body: parsed.data })
    ).catch(() => null);
    setPending(false);
    if (res && (res.status === 200 || res.status === 201)) {
      const next = res.body as AdminPromoCode;
      if (!saved) {
        router.push(`/promo-codes/${next.id}`);
        return;
      }
      setSaved(next);
      setDraft(toDraft(next));
      setBanner({ kind: 'ok', text: m.saved });
      router.refresh();
      return;
    }
    if (res?.status === 409 && (res.body as { code?: string }).code === 'code_taken') {
      setErrors({ code: m.codeTaken });
      setBanner({ kind: 'error', text: m.codeTaken });
    } else setBanner({ kind: 'error', text: m.failed });
  };

  const remove = async () => {
    if (!saved) return;
    const res = await browserApi.promoCodes.remove({ params: { id: saved.id } }).catch(() => null);
    setRemoving(false);
    if (res?.status === 200) {
      router.push('/promo-codes');
      router.refresh();
      return;
    }
    setBanner({ kind: 'error', text: res?.status === 409 ? m.inUse : m.failed });
  };

  const numberField = (field: NumberField, label: string, hint: string, money = false) => (
    <Field
      id={`p-${field}`}
      label={label}
      hint={(money ? moneyEcho(draft[field], language) : undefined) ?? hint}
      error={errors[field]}
    >
      <Input
        inputMode="numeric"
        className="tabular-nums"
        value={draft[field]}
        onChange={(e) => set(field, e.target.value)}
      />
    </Field>
  );

  const percent = draft.kind === 'percent';
  const preview = toInput(draft);
  const used = saved?.everUsed ?? false;
  return (
    // fields focused by a failed save scroll clear of the top bar and the sticky save bar
    <form
      noValidate
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="[&_:is(input,select)]:scroll-mt-24 [&_:is(input,select)]:scroll-mb-28"
    >
      <PageHeader
        title={saved ? saved.code : m.newTitle}
        description={
          saved
            ? saved.totalLimit === null
              ? fill(m.usage, { used: num(saved.uses) })
              : fill(m.usageOf, { used: num(saved.uses), limit: num(saved.totalLimit) })
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {saved && (
              <Badge tone={saved.state === 'active' ? 'sage' : 'neutral'}>
                {m.states[saved.state]}
              </Badge>
            )}
            <Button variant="outline" asChild>
              <Link href="/promo-codes">
                <ArrowLeft strokeWidth={1.5} aria-hidden />
                {m.back}
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4">
        <Section title={m.sectionCode}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="p-code" label={m.code} hint={m.codeHint} error={errors.code}>
              <Input
                value={draft.code}
                maxLength={32}
                autoCapitalize="characters"
                spellCheck={false}
                className="font-semibold tracking-[0.04em] uppercase placeholder:font-normal placeholder:tracking-normal placeholder:normal-case"
                placeholder="BLOGER10"
                onChange={(e) => set('code', e.target.value)}
              />
            </Field>
            <Field id="p-kind" label={m.kind}>
              <Select value={draft.kind} onChange={(e) => set('kind', e.target.value as PromoKind)}>
                {PROMO_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {m.kinds[k]}
                  </option>
                ))}
              </Select>
            </Field>
            {percent ? (
              <>
                {numberField('percent', m.percent, m.percentHint)}
                {numberField('maxDiscount', m.maxDiscount, m.maxDiscountHint, true)}
              </>
            ) : (
              numberField('amount', m.amount, m.amountHint, true)
            )}
          </div>
          {/* the discount as the list will read it, once it is a valid one */}
          {promoCodeInputSchema.safeParse(preview).success && (
            <p className="text-sm text-muted-foreground" data-promo-preview>
              <span className="font-semibold text-foreground">
                {discountOf(preview, t, language)}
              </span>
            </p>
          )}
        </Section>

        <Section title={m.sectionTerms}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="p-expires"
              label={m.expiresOn}
              hint={m.expiresOnHint}
              error={errors.expiresOn}
            >
              <Input
                type="date"
                className="tabular-nums"
                value={draft.expiresOn}
                onChange={(e) => set('expiresOn', e.target.value)}
              />
            </Field>
            {numberField('minOrderTotal', m.minOrderTotal, m.minOrderTotalHint, true)}
          </div>
          <Toggle
            label={m.newCustomersOnly}
            hint={m.newCustomersOnlyHint}
            checked={draft.newCustomersOnly}
            onChange={(v) => set('newCustomersOnly', v)}
          />
          <Toggle
            label={m.appliesToMarkedDown}
            hint={m.appliesToMarkedDownHint}
            checked={draft.appliesToMarkedDown}
            onChange={(v) => set('appliesToMarkedDown', v)}
          />
        </Section>

        <Section title={m.sectionLimits}>
          <div className="grid gap-4 md:grid-cols-2">
            {numberField('totalLimit', m.totalLimit, m.totalLimitHint)}
            {numberField('perCustomerLimit', m.perCustomerLimit, m.perCustomerLimitHint)}
          </div>
          <Toggle
            label={m.active}
            hint={m.activeHint}
            checked={draft.active}
            onChange={(v) => set('active', v)}
          />
          {saved && used && (
            <p className="text-small text-pretty text-muted-foreground">{m.usedNote}</p>
          )}
        </Section>
        {saved && !used && (
          // deleting is rare and final: kept out of the save bar, at the end of the form
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={() => setRemoving(true)}>
              {m.remove}
            </Button>
          </div>
        )}
      </div>

      {/* the save bar: a Milk dock with a top hairline, edge to edge of the content column */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Button type="submit" loading={pending} className="max-sm:w-full sm:min-w-40">
          {m.save}
        </Button>
        {banner && (
          <p
            key={banner.text}
            role={banner.kind === 'error' ? 'alert' : 'status'}
            className="flex min-w-0 flex-1 animate-[overlay-in_200ms_var(--ease-out)] items-start gap-2 text-sm leading-snug font-medium text-pretty"
          >
            {banner.kind === 'ok' ? (
              <Check
                className="mt-px size-4 shrink-0 text-sage-ink"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : (
              <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            )}
            {banner.text}
          </p>
        )}
      </div>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogTitle>{m.removeTitle}</AlertDialogTitle>
          <AlertDialogDescription>{m.removeText}</AlertDialogDescription>
          <DialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{m.cancel}</Button>
            </AlertDialogCancel>
            <Button onClick={() => void remove()}>{m.remove}</Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-0.5 size-[18px] shrink-0 accent-graphite"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-[13px] text-pretty text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

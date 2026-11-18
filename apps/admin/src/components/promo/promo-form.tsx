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
import { CodeText } from './code-text';
import { discountOf } from './terms';

/** A fragrance a gift code may give, with the volumes it is sold in (ADR 0039). */
export interface GiftChoice {
  id: number;
  name: string;
  volumes: number[];
}

/** The gift picker's value: the Discovery set, a fragrance (`f<id>`), or nothing yet. */
const DISCOVERY = 'discovery';

/** The form as typed: numbers stay text until the save, so a half-typed one is never rewritten. */
interface Draft {
  code: string;
  kind: PromoKind;
  /** A gift code's item: `discovery`, `f<fragrance id>`, or '' (none chosen). */
  gift: string;
  /** The gift fragrance's volume in ml, as text; '' until chosen. */
  giftMl: string;
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
    gift: !p?.gift ? '' : p.gift.kind === 'discovery_set' ? DISCOVERY : `f${p.gift.fragranceId}`,
    giftMl: p?.gift?.kind === 'volume' ? String(p.gift.ml) : '',
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

/** The chosen gift as the API takes it; null until both the fragrance and its volume are picked. */
function giftOf(d: Draft): PromoCodeInput['gift'] {
  if (d.gift === DISCOVERY) return { kind: 'discovery_set' };
  const ml = Number(d.giftMl);
  if (!d.gift.startsWith('f') || (ml !== 10 && ml !== 30 && ml !== 50)) return null;
  return { kind: 'volume', fragranceId: Number(d.gift.slice(1)), ml };
}

/**
 * The body the API takes; the fields of the other kinds are sent empty, as the schema asks. A gift
 * cuts no item's price, so its marked-down switch is sent off (ADR 0039).
 */
function toInput(d: Draft): PromoCodeInput {
  const percent = d.kind === 'percent';
  const gift = d.kind === 'gift';
  return {
    code: d.code,
    kind: d.kind,
    percent: percent ? number(d.percent) : null,
    amount: d.kind === 'fixed' ? number(d.amount) : null,
    maxDiscount: percent ? number(d.maxDiscount) : null,
    gift: gift ? giftOf(d) : null,
    expiresOn: d.expiresOn === '' ? null : d.expiresOn,
    minOrderTotal: number(d.minOrderTotal),
    totalLimit: number(d.totalLimit),
    perCustomerLimit: number(d.perCustomerLimit),
    newCustomersOnly: d.newCustomersOnly,
    appliesToMarkedDown: gift ? false : d.appliesToMarkedDown,
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
  giftChoices,
  language,
  t,
}: {
  initial: AdminPromoCode | null;
  /** The fragrances a gift code may give, by name. */
  giftChoices: GiftChoice[];
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
    // a fragrance without its volume reads as «choose the volume», not as no gift at all
    if (field === 'gift')
      return draft.gift.startsWith('f') ? m.errors.giftVolume : m.errors.gift;
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
    } else if (res?.status === 422) {
      // the gift's volume left the catalog while the form was open
      setErrors({ gift: m.errors.gift });
      setBanner({ kind: 'error', text: m.fixErrors });
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
    if (res?.status === 409) {
      // an order took the code while the editor was open: it now reads as a used code
      setSaved({ ...saved, everUsed: true });
      setBanner({ kind: 'error', text: m.inUse });
    } else setBanner({ kind: 'error', text: m.failed });
  };

  const numberField = (field: NumberField, label: string, hint: string, money = false) => (
    <Field
      id={`p-${field}`}
      className="content-start"
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
  const giftKind = draft.kind === 'gift';
  const preview = toInput(draft);
  const giftFragrance = draft.gift.startsWith('f')
    ? giftChoices.find((f) => `f${f.id}` === draft.gift)
    : undefined;
  // the preview names the gift as the list will
  const previewGift: AdminPromoCode['gift'] =
    preview.gift?.kind === 'volume'
      ? { ...preview.gift, name: giftFragrance?.name ?? '', brand: '' }
      : preview.gift;
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
        title={saved ? <CodeText code={saved.code} /> : m.newTitle}
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
            <Field
              id="p-code"
              className="content-start"
              label={m.code}
              hint={m.codeHint}
              error={errors.code}
            >
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
            <Field id="p-kind" className="content-start" label={m.kind}>
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
            ) : giftKind ? (
              <>
                <Field
                  id="p-gift"
                  className="content-start"
                  label={m.gift}
                  hint={m.giftHint}
                  error={errors.gift}
                >
                  <Select
                    value={draft.gift}
                    onChange={(e) => {
                      const next = e.target.value;
                      const f = giftChoices.find((c) => `f${c.id}` === next);
                      set('gift', next);
                      // keep the volume when the new fragrance has it, else the only one it has
                      setDraft((d) => ({
                        ...d,
                        giftMl:
                          f && f.volumes.includes(Number(d.giftMl))
                            ? d.giftMl
                            : f?.volumes.length === 1
                              ? String(f.volumes[0])
                              : '',
                      }));
                    }}
                  >
                    <option value="">{m.giftChoose}</option>
                    <option value={DISCOVERY}>{m.giftDiscovery}</option>
                    {giftChoices.map((f) => (
                      <option key={f.id} value={`f${f.id}`}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {giftFragrance && (
                  <Field id="p-gift-ml" className="content-start" label={m.giftVolume}>
                    <Select value={draft.giftMl} onChange={(e) => set('giftMl', e.target.value)}>
                      <option value="">{m.giftVolumeChoose}</option>
                      {giftFragrance.volumes.map((ml) => (
                        <option key={ml} value={String(ml)}>
                          {fill(m.giftMl, { ml: String(ml) })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </>
            ) : (
              numberField('amount', m.amount, m.amountHint, true)
            )}
          </div>
          {/* what the shopper gets, as the list will read it, once the discount is a valid one */}
          {promoCodeInputSchema.safeParse(preview).success && (
            <p
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-border pt-4 text-sm text-muted-foreground"
              data-promo-preview
            >
              {m.preview}
              <span className="font-semibold text-foreground tabular-nums">
                {discountOf({ ...preview, gift: previewGift }, t, language)}
              </span>
            </p>
          )}
        </Section>

        <Section title={m.sectionTerms}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="p-expires"
              className="content-start"
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
          {/* a gift cuts no item's price: the marked-down switch means nothing for it */}
          {!giftKind && (
            <Toggle
              label={m.appliesToMarkedDown}
              hint={m.appliesToMarkedDownHint}
              checked={draft.appliesToMarkedDown}
              onChange={(v) => set('appliesToMarkedDown', v)}
            />
          )}
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

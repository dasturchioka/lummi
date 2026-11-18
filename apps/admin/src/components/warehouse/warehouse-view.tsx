'use client';

import {
  MAX_BOTTLING_QUANTITY,
  MAX_OIL_RECEIPT_GRAMS,
  OIL_TEXT_MAX,
  STOCK_REASON_MAX,
  WAREHOUSE_HISTORY_LIMIT,
  type OilReceipt,
  type OilReceiptInput,
  type StockMove,
  type WarehouseFragrance,
} from '@lummi/contracts';
import { formatCalendarDate, formatMoney, type Language } from '@lummi/i18n';
import { ArrowLeft, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent, num } from '@/lib/setting-copy';
import { TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

type W = AdminMessages['warehouse'];

/** A typed number: spaces dropped, a comma read as the decimal point; null when it is not one. */
function parseNumber(v: string): number | null {
  const s = v.replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** A signed change: «+3», «−9,27» (a true minus), nothing for zero. */
const signed = (n: number) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : '');
const grams3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A fragrance's warehouse page (#76, ADR 0041): its oil and bottles, the bottling form, the
 * owner's oil receipts, and the history. Every figure is the API's; the bottling preview multiplies
 * the server's per-bottle oil by the counts typed, and the server takes the real amount.
 */
export function WarehouseView({
  data,
  today,
  language,
  t,
}: {
  data: WarehouseFragrance;
  /** Tashkent's today, `YYYY-MM-DD`: the oil receipt form's date. */
  today: string;
  language: Language;
  t: AdminMessages;
}) {
  const w = t.warehouse;
  const owner = data.oilReceipts !== null;
  return (
    <>
      <PageHeader
        title={data.name}
        description={w.description}
        actions={
          <Link href="/stock" className={cn(TEXT_LINK, 'inline-flex items-center gap-1.5')}>
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
            {w.back}
          </Link>
        }
      />
      <div className="grid gap-4 lg:gap-5">
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
          <OilSection data={data} language={language} w={w} />
          <BottlesSection data={data} w={w} />
        </div>
        <BottlingSection data={data} w={w} />
        {owner && data.oilReceiptDefaults && (
          <OilReceiptSection
            fragranceId={data.fragranceId}
            defaults={data.oilReceiptDefaults}
            today={today}
            w={w}
          />
        )}
        {owner && <OilReceiptsSection oilReceipts={data.oilReceipts!} language={language} w={w} />}
        <HistorySection history={data.history} w={w} />
      </div>
    </>
  );
}

function OilSection({ data, language, w }: { data: WarehouseFragrance; language: Language; w: W }) {
  const { oil } = data;
  const money = (n: number) => formatMoney(n, language);
  return (
    <Section title={w.oil}>
      <div className="grid gap-1" data-testid="oil" data-level={oil.level}>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-2xl leading-tight font-semibold tabular-nums">
            {fill(w.grams, { grams: num(oil.oilGrams) })}
          </span>
          {oil.level !== 'ok' && (
            <span
              className={cn(
                'inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
                oil.level === 'zero' ? 'bg-stone text-graphite' : 'bg-sage-wash text-sage-ink',
              )}
            >
              {oil.level === 'zero' ? w.levelZero : w.levelLow}
            </span>
          )}
        </p>
        <p className="font-medium tabular-nums">
          {fill(w.liquid, { litres: num(oil.liquidLitres) })}
        </p>
        <p className="max-w-[60ch] text-small text-pretty text-muted-foreground">
          {w.liquidHint} {fill(w.lowHint, { n: num(data.lowOilLitres) })}
        </p>
      </div>
      {oil.value && (
        <dl className="grid gap-2 rounded-button bg-field px-4 py-3 text-sm">
          <dt className="text-small font-medium text-muted-foreground">{w.value}</dt>
          {(
            [
              [w.valueOil, oil.value.oil],
              [w.valueBottles, oil.value.bottles],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt>{label}</dt>
              <dd className="tabular-nums">{value === null ? '—' : money(value)}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <dt className="font-semibold">{w.valueTotal}</dt>
            <dd className="font-semibold tabular-nums">
              {oil.value.total === null ? '—' : money(oil.value.total)}
            </dd>
          </div>
          {oil.value.bottles === null && (
            <p className="text-small text-pretty text-muted-foreground">{w.valueUnknown}</p>
          )}
        </dl>
      )}
    </Section>
  );
}

function BottlesSection({ data, w }: { data: WarehouseFragrance; w: W }) {
  return (
    <Section title={w.bottles}>
      <ul className="-my-2 divide-y divide-border">
        {data.volumes.map((v) => (
          <li
            key={v.volumeId}
            className="flex items-baseline justify-between gap-3 py-2.5"
            data-testid={`bottles-${v.ml}`}
          >
            <span className="grid">
              <span className="font-medium">{fill(w.ml, { ml: String(v.ml) })}</span>
              <span className="text-small text-muted-foreground tabular-nums">
                {fill(w.reservedLine, { reserved: num(v.reserved), available: num(v.available) })}
              </span>
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {fill(w.pieces, { n: num(v.onHand) })}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

type BottlingState =
  | { kind: 'idle' }
  | { kind: 'done'; grams: number }
  | { kind: 'short'; needed: number; balance: number }
  | { kind: 'empty' | 'invalid' | 'failed' | 'busy' };

function BottlingSection({ data, w }: { data: WarehouseFragrance; w: W }) {
  const b = w.bottling;
  const router = useRouter();
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<BottlingState>({ kind: 'idle' });

  const typed = data.volumes.map((v) => ({ ml: v.ml, raw: counts[v.ml] ?? '' }));
  const valid = typed.every((l) => l.raw === '' || /^\d{1,5}$/.test(l.raw));
  const lines = typed
    .filter((l) => l.raw !== '' && /^\d{1,5}$/.test(l.raw))
    .map((l) => ({ ml: l.ml, quantity: Number(l.raw) }))
    .filter((l) => l.quantity > 0);
  // the preview only: the server takes the real amount with the settings of the moment
  const preview = lines.reduce(
    (a, l) => {
      const each = data.perBottle.find((p) => p.ml === l.ml);
      return each
        ? {
            oil: a.oil + each.oilGrams * l.quantity,
            ethanol: a.ethanol + each.ethanolMl * l.quantity,
          }
        : a;
    },
    { oil: 0, ethanol: 0 },
  );

  async function submit() {
    if (!valid || lines.some((l) => l.quantity > MAX_BOTTLING_QUANTITY))
      return setState({ kind: 'invalid' });
    if (lines.length === 0) return setState({ kind: 'empty' });
    setPending(true);
    const res = await browserApi.warehouse
      .bottle({ params: { id: data.fragranceId }, body: { lines } })
      .catch(() => null);
    setPending(false);
    if (res?.status === 201) {
      setCounts({});
      setState({ kind: 'done', grams: res.body.oilGrams });
      router.refresh();
    } else if (res?.status === 409 && res.body.code === 'oil_short') {
      setState({
        kind: 'short',
        needed: res.body.neededGrams ?? 0,
        balance: res.body.balanceGrams ?? 0,
      });
      router.refresh();
    } else setState({ kind: res?.status === 409 ? 'busy' : 'failed' });
  }

  return (
    <Section title={b.title}>
      <p className="-mt-2 max-w-[70ch] text-sm text-pretty text-muted-foreground">{b.text}</p>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {data.volumes.map((v) => (
            <Field key={v.ml} id={`bottle-${v.ml}`} label={fill(b.count, { ml: String(v.ml) })}>
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="0"
                className="tabular-nums"
                value={counts[v.ml] ?? ''}
                onChange={(e) => {
                  setCounts((c) => ({ ...c, [v.ml]: e.target.value }));
                  setState({ kind: 'idle' });
                }}
              />
            </Field>
          ))}
        </div>
        {lines.length > 0 && (
          <p className="text-sm tabular-nums" aria-live="polite">
            <span className="font-medium">
              {fill(b.needs, {
                grams: num(grams3(preview.oil)),
                ml: num(Math.round(preview.ethanol)),
              })}
            </span>
            <span className="text-muted-foreground">
              {' · '}
              {fill(b.left, { grams: num(grams3(data.oil.oilGrams - preview.oil)) })}
            </span>
          </p>
        )}
        {state.kind === 'short' && (
          <Notice
            title={fill(b.short, {
              needed: num(state.needed),
              balance: num(state.balance),
            })}
          />
        )}
        {(state.kind === 'failed' || state.kind === 'busy') && (
          <Notice title={state.kind === 'busy' ? w.tryAgain : w.failed} />
        )}
        {(state.kind === 'empty' || state.kind === 'invalid') && (
          <p role="alert" className="text-xs font-medium">
            {state.kind === 'empty' ? b.empty : b.invalid}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={pending}>
            {b.submit}
          </Button>
          {state.kind === 'done' && (
            <span role="status" className="inline-flex items-center gap-1.5 text-small">
              <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {fill(b.done, { grams: num(state.grams) })}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

/** The oil receipt form's fields as typed (strings), shared by a new oil receipt and a correction. */
type OilReceiptDraft = Record<keyof OilReceiptInput, string>;
type DraftKey = keyof OilReceiptInput;

/** The draft as the API takes it, or the fields to fix. */
function readDraft(
  d: OilReceiptDraft,
): { ok: true; value: OilReceiptInput } | { ok: false; bad: Set<string> } {
  const bad = new Set<string>();
  const text = (k: 'supplier' | 'invoice') => {
    const v = d[k].trim();
    if (!v || v.length > OIL_TEXT_MAX) bad.add(k);
    return v;
  };
  const number = (k: DraftKey, check: (n: number) => boolean) => {
    const n = parseNumber(d[k]);
    if (n === null || !check(n)) bad.add(k);
    return n ?? 0;
  };
  const value: OilReceiptInput = {
    supplier: text('supplier'),
    invoice: text('invoice'),
    receivedOn: d.receivedOn,
    grams: number('grams', (n) => n > 0 && n <= MAX_OIL_RECEIPT_GRAMS),
    pricePerGram: number('pricePerGram', (n) => Number.isInteger(n) && n >= 1),
    discountPercent: number('discountPercent', (n) => n >= 0 && n <= 100),
    importPercent: number('importPercent', (n) => n >= 0 && n <= 100),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.receivedOn)) bad.add('receivedOn');
  return bad.size ? { ok: false, bad } : { ok: true, value };
}

function OilReceiptFields({
  idPrefix,
  draft,
  bad,
  onChange,
  w,
}: {
  idPrefix: string;
  draft: OilReceiptDraft;
  bad: Set<string>;
  onChange: (d: OilReceiptDraft) => void;
  w: W;
}) {
  const r = w.oilReceipt;
  const input = (k: DraftKey) => {
    const numeric = !['supplier', 'invoice', 'receivedOn'].includes(k);
    return (
      <Field key={k} id={`${idPrefix}-${k}`} label={r[k]}>
        <Input
          type={k === 'receivedOn' ? 'date' : 'text'}
          inputMode={numeric ? 'decimal' : undefined}
          autoComplete="off"
          maxLength={numeric ? 12 : OIL_TEXT_MAX}
          className={numeric ? 'tabular-nums' : undefined}
          aria-invalid={bad.has(k) || undefined}
          value={draft[k]}
          onChange={(e) => onChange({ ...draft, [k]: e.target.value })}
        />
      </Field>
    );
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">{input('supplier')}</div>
      {input('invoice')}
      {input('receivedOn')}
      {input('grams')}
      {input('pricePerGram')}
      {input('discountPercent')}
      {input('importPercent')}
    </div>
  );
}

function OilReceiptSection({
  fragranceId,
  defaults,
  today,
  w,
}: {
  fragranceId: number;
  defaults: NonNullable<WarehouseFragrance['oilReceiptDefaults']>;
  today: string;
  w: W;
}) {
  const r = w.oilReceipt;
  const router = useRouter();
  const blank = (): OilReceiptDraft => ({
    supplier: defaults.supplier ?? '',
    invoice: '',
    receivedOn: today,
    grams: '',
    pricePerGram: defaults.pricePerGram === null ? '' : String(defaults.pricePerGram),
    discountPercent: String(defaults.discountPercent),
    importPercent: String(defaults.importPercent),
  });
  const [draft, setDraft] = useState<OilReceiptDraft>(blank);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' | 'failed' } | { kind: 'done'; grams: number }>(
    { kind: 'idle' },
  );

  async function submit() {
    const read = readDraft(draft);
    if (!read.ok) return setBad(read.bad);
    setBad(new Set());
    setPending(true);
    const res = await browserApi.warehouse
      .receiveOil({ params: { id: fragranceId }, body: read.value })
      .catch(() => null);
    setPending(false);
    if (res?.status === 201) {
      setDraft({ ...blank(), supplier: read.value.supplier });
      setState({ kind: 'done', grams: res.body.grams });
      router.refresh();
    } else setState({ kind: 'failed' });
  }

  return (
    <Section title={r.title}>
      <p className="-mt-2 max-w-[70ch] text-sm text-pretty text-muted-foreground">{r.text}</p>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <OilReceiptFields
          idPrefix="oil-receipt"
          draft={draft}
          bad={bad}
          onChange={(d) => {
            setDraft(d);
            setState({ kind: 'idle' });
          }}
          w={w}
        />
        {bad.size > 0 && (
          <p role="alert" className="text-xs font-medium">
            {r.invalid}
          </p>
        )}
        {state.kind === 'failed' && <Notice title={w.failed} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={pending}>
            {r.submit}
          </Button>
          {state.kind === 'done' && (
            <span role="status" className="inline-flex items-center gap-1.5 text-small">
              <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {fill(r.done, { grams: num(state.grams) })}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

function OilReceiptsSection({
  oilReceipts,
  language,
  w,
}: {
  oilReceipts: OilReceipt[];
  language: Language;
  w: W;
}) {
  const rs = w.oilReceipts;
  const [correcting, setCorrecting] = useState<OilReceipt | null>(null);
  const [voiding, setVoiding] = useState<OilReceipt | null>(null);
  const [discarding, setDiscarding] = useState<OilReceipt | null>(null);
  const money = (n: number) => formatMoney(n, language);
  return (
    <Section title={rs.title}>
      {oilReceipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{rs.empty}</p>
      ) : (
        <ul className="-my-2 divide-y divide-border">
          {oilReceipts.map((r) => (
            <li
              key={r.id}
              data-testid={`oil-receipt-${r.id}`}
              className={cn(
                'grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4',
                r.voided && 'text-muted-foreground',
              )}
            >
              <div className="grid min-w-0 gap-0.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold leading-snug [overflow-wrap:anywhere]">
                  {r.draft && (
                    <span className="inline-flex h-6 items-center rounded-full bg-field px-2.5 text-xs font-semibold">
                      {rs.draft}
                    </span>
                  )}
                  <span>
                    {[formatCalendarDate(r.receivedOn, language), r.invoice, r.supplier]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </p>
                <p className="text-sm tabular-nums">
                  {fill(rs.line, {
                    grams: num(r.grams),
                    price: money(r.pricePerGram),
                    discount: num(r.discountPercent),
                    import: num(r.importPercent),
                  })}
                </p>
                <p className="text-small text-muted-foreground tabular-nums">
                  {fill(rs.landed, { perGram: money(r.landedPerGram), total: money(r.total) })}
                </p>
                {r.voided && (
                  <p className="text-small font-medium">
                    {fill(rs.voided, { reason: r.voidReason ?? '' })}
                  </p>
                )}
                {r.draft && <p className="text-small font-medium">{rs.draftLine}</p>}
              </div>
              {r.draft && (
                <div className="flex gap-1 sm:-mr-2">
                  <Button variant="ghost" size="sm" onClick={() => setCorrecting(r)}>
                    {rs.confirm}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDiscarding(r)}>
                    {rs.discard}
                  </Button>
                </div>
              )}
              {!r.voided && !r.draft && (
                <div className="flex gap-1 sm:-mr-2">
                  <Button variant="ghost" size="sm" onClick={() => setCorrecting(r)}>
                    {rs.correct}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setVoiding(r)}>
                    {rs.void}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {correcting && (
        <CorrectDialog oilReceipt={correcting} onClose={() => setCorrecting(null)} w={w} />
      )}
      {voiding && <VoidDialog oilReceipt={voiding} onClose={() => setVoiding(null)} w={w} />}
      {discarding && (
        <DiscardDialog oilReceipt={discarding} onClose={() => setDiscarding(null)} w={w} />
      )}
    </Section>
  );
}

/** What a refused correction or void says: the oil went into bottles, or the oil receipt is voided. */
function refusal(res: { status: number; body: unknown } | null, w: W): string {
  const body = (res?.body ?? {}) as { code?: string; neededGrams?: number; balanceGrams?: number };
  if (res?.status === 409 && body.code === 'oil_short')
    return fill(w.oilReceipts.short, {
      needed: num(body.neededGrams ?? 0),
      balance: num(body.balanceGrams ?? 0),
    });
  if (res?.status === 409 && body.code === 'voided') return w.oilReceipts.alreadyVoided;
  if (res?.status === 409 && (body.code === 'not_draft' || body.code === 'draft'))
    return w.oilReceipts.notDraft;
  if (res?.status === 409) return w.tryAgain;
  return w.failed;
}

function CorrectDialog({
  oilReceipt,
  onClose,
  w,
}: {
  oilReceipt: OilReceipt;
  onClose: () => void;
  w: W;
}) {
  const rs = w.oilReceipts;
  const router = useRouter();
  const [draft, setDraft] = useState<OilReceiptDraft>({
    supplier: oilReceipt.supplier,
    invoice: oilReceipt.invoice,
    receivedOn: oilReceipt.receivedOn,
    grams: String(oilReceipt.grams),
    pricePerGram: String(oilReceipt.pricePerGram),
    discountPercent: String(oilReceipt.discountPercent),
    importPercent: String(oilReceipt.importPercent),
  });
  const [reason, setReason] = useState('');
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A draft is confirmed as the invoice reads (no reason); an oil receipt is corrected with one. */
  const confirming = oilReceipt.draft;

  async function save() {
    const read = readDraft(draft);
    const fix = read.ok ? new Set<string>() : read.bad;
    if (!confirming && !reason.trim()) fix.add('reason');
    setBad(fix);
    if (!read.ok || fix.size) return;
    setPending(true);
    const res = await (
      confirming
        ? browserApi.warehouse.confirmOilReceipt({
            params: { id: oilReceipt.id },
            body: read.value,
          })
        : browserApi.warehouse.correctOilReceipt({
            params: { id: oilReceipt.id },
            body: { ...read.value, reason: reason.trim() },
          })
    ).catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      onClose();
      router.refresh();
    } else setError(refusal(res, w));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:w-[min(640px,calc(100vw-32px))]">
        <DialogTitle>{confirming ? rs.confirmTitle : rs.correctTitle}</DialogTitle>
        <DialogDescription>
          {confirming
            ? rs.confirmText
            : [oilReceipt.invoice, oilReceipt.supplier].filter(Boolean).join(' · ')}
        </DialogDescription>
        <form
          className="mt-5 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <OilReceiptFields
            idPrefix={`fix-${oilReceipt.id}`}
            draft={draft}
            bad={bad}
            onChange={(d) => {
              setDraft(d);
              setError(null);
            }}
            w={w}
          />
          {!confirming && (
            <Field id={`fix-${oilReceipt.id}-reason`} label={rs.reason}>
              <Input
                autoComplete="off"
                maxLength={STOCK_REASON_MAX}
                aria-invalid={bad.has('reason') || undefined}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
              />
            </Field>
          )}
          {bad.size > 0 && (
            <p role="alert" className="text-xs font-medium">
              {w.oilReceipt.invalid}
            </p>
          )}
          {error && <Notice title={error} />}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {rs.cancel}
            </Button>
            <Button type="submit" loading={pending}>
              {confirming ? rs.confirm : rs.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({
  oilReceipt,
  onClose,
  w,
}: {
  oilReceipt: OilReceipt;
  onClose: () => void;
  w: W;
}) {
  const rs = w.oilReceipts;
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!reason.trim()) return;
    setPending(true);
    const res = await browserApi.warehouse
      .voidOilReceipt({ params: { id: oilReceipt.id }, body: { reason: reason.trim() } })
      .catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      onClose();
      router.refresh();
    } else setError(refusal(res, w));
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>{fill(rs.voidTitle, { invoice: oilReceipt.invoice })}</AlertDialogTitle>
        <AlertDialogDescription>
          {fill(rs.voidText, { grams: num(oilReceipt.grams) })}
        </AlertDialogDescription>
        <div className="mt-5 grid gap-3">
          <Field id={`void-${oilReceipt.id}-reason`} label={rs.reason}>
            <Input
              autoComplete="off"
              maxLength={STOCK_REASON_MAX}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
            />
          </Field>
          {error && <Notice title={error} />}
        </div>
        <DialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">{rs.cancel}</Button>
          </AlertDialogCancel>
          <Button loading={pending} disabled={!reason.trim()} onClick={() => void confirm()}>
            {rs.voidConfirm}
          </Button>
        </DialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DiscardDialog({
  oilReceipt,
  onClose,
  w,
}: {
  oilReceipt: OilReceipt;
  onClose: () => void;
  w: W;
}) {
  const rs = w.oilReceipts;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discard() {
    setPending(true);
    const res = await browserApi.warehouse
      .discardOilReceipt({ params: { id: oilReceipt.id } })
      .catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      onClose();
      router.refresh();
    } else setError(refusal(res, w));
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>{rs.discardTitle}</AlertDialogTitle>
        <AlertDialogDescription>{rs.discardText}</AlertDialogDescription>
        {error && <Notice className="mt-4" title={error} />}
        <DialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">{rs.cancel}</Button>
          </AlertDialogCancel>
          <Button loading={pending} onClick={() => void discard()}>
            {rs.discard}
          </Button>
        </DialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The bottles of a move: «10 мл +3, 30 мл −1». */
const bottlesText = (m: StockMove, w: W) =>
  m.bottles.map((b) => `${fill(w.ml, { ml: String(b.ml) })} ${signed(b.change)}`).join(', ');

/** Where it came from: the order, the Uzum order, the invoice, or where a count was typed. */
function documentText(m: StockMove, w: W): string | null {
  if (m.orderNumber !== null) return fill(w.order, { number: String(m.orderNumber) });
  if (m.uzumOrder !== null) return fill(w.uzumOrder, { number: m.uzumOrder });
  if (m.invoice !== null) return [m.supplier, m.invoice].filter(Boolean).join(', ');
  if (m.source !== null) return w.sources[m.source];
  return null;
}

function HistorySection({ history, w }: { history: StockMove[]; w: W }) {
  const h = w.history;
  return (
    <Section title={h.title}>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">{h.empty}</p>
      ) : (
        <>
          {/* phones: one block per move */}
          <ul className="-my-2 divide-y divide-border md:hidden">
            {history.map((m) => {
              const doc = documentText(m, w);
              return (
                <li key={m.id} className="grid gap-0.5 py-3" data-testid={`move-${m.id}`}>
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{w.kinds[m.kind]}</span>
                    <span className="text-small text-muted-foreground tabular-nums">
                      {formatTashkent(m.at)}
                    </span>
                  </p>
                  <p className="text-sm tabular-nums">
                    {[
                      m.oilGrams ? `${h.oil} ${signed(m.oilGrams)}` : null,
                      bottlesText(m, w) || null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {(doc || m.reason) && (
                    <p className="text-small text-muted-foreground [overflow-wrap:anywhere]">
                      {[doc, m.reason].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <p className="text-small text-muted-foreground">{m.actorName ?? h.shop}</p>
                </li>
              );
            })}
          </ul>
          <div className="-mx-4 hidden sm:-mx-6 md:block">
            <Table>
              <THead>
                <TR>
                  <TH>{h.when}</TH>
                  <TH>{h.what}</TH>
                  <TH className="text-right">{h.oil}</TH>
                  <TH>{h.bottles}</TH>
                  <TH>{h.note}</TH>
                  <TH>{h.who}</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((m) => {
                  const doc = documentText(m, w);
                  return (
                    <TR key={m.id} data-testid={`move-row-${m.id}`}>
                      <TD className="whitespace-nowrap text-muted-foreground">
                        {formatTashkent(m.at)}
                      </TD>
                      <TD className="font-medium">{w.kinds[m.kind]}</TD>
                      <TD className="text-right whitespace-nowrap">{signed(m.oilGrams)}</TD>
                      <TD className="whitespace-nowrap">{bottlesText(m, w)}</TD>
                      <TD className="max-w-[22rem] [overflow-wrap:anywhere]">
                        {doc && <span className="block">{doc}</span>}
                        {m.reason && (
                          <span className="block text-small text-muted-foreground">{m.reason}</span>
                        )}
                      </TD>
                      <TD className="text-muted-foreground">{m.actorName ?? h.shop}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
          {history.length >= WAREHOUSE_HISTORY_LIMIT && (
            <p className="text-small text-muted-foreground">
              {fill(h.limit, { n: String(WAREHOUSE_HISTORY_LIMIT) })}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

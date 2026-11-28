'use client';

import {
  MAX_CONCENTRATE_ML,
  MAX_MIX_ML,
  MAX_OIL_RECEIPT_GRAMS,
  OIL_TEXT_MAX,
  round3,
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
import { LevelTag } from '@/components/stock-table';
import { CountEditor, parseCount } from '@/components/stock/count-editor';
import { useCount } from '@/components/stock/use-count';
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

/**
 * A fragrance's warehouse page (#76, ADR 0041, 0043): its ready concentrate (counted here with a
 * reason) and the bottles it fills, its oil in ml and grams, mixing concentrate from oil and
 * ethanol, the owner's oil receipts, and the history. Every figure is the API's; the mixing
 * preview multiplies the server's per-ml shares by the ml typed, and the server takes the real
 * amount.
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
          <ConcentrateSection data={data} t={t} />
          <OilSection data={data} language={language} w={w} />
        </div>
        <MixingSection data={data} t={t} />
        {owner && data.oilReceiptDefaults && (
          <OilReceiptSection
            fragranceId={data.fragranceId}
            defaults={data.oilReceiptDefaults}
            today={today}
            w={w}
          />
        )}
        {owner && <OilReceiptsSection oilReceipts={data.oilReceipts!} language={language} w={w} />}
        <Section title={w.history.title}>
          <HistoryList history={data.history} language={language} w={w} />
        </Section>
      </div>
    </>
  );
}

/** The ready concentrate (ADR 0043): counted, held by orders, free, and the bottles it fills. */
function ConcentrateSection({ data, t }: { data: WarehouseFragrance; t: AdminMessages }) {
  const w = t.warehouse;
  const { stock } = data;
  const ml = (n: number) => fill(w.mlValue, { ml: num(n) });
  const row = {
    key: 'concentrate',
    onHand: stock.concentrateMl,
    reserved: stock.reservedMl,
    unit: 'ml' as const,
    max: MAX_CONCENTRATE_ML,
  };
  const count = useCount(async (_key, value, expected, reason) => {
    const res = await browserApi.warehouse.countConcentrate({
      params: { id: data.fragranceId },
      body: { ml: value, expectedMl: expected, reason },
    });
    if (res.status === 200) return { kind: 'saved' };
    if (res.status === 409 && res.body.code === 'changed' && res.body.currentMl !== undefined)
      return { kind: 'changed', current: res.body.currentMl };
    return { kind: res.status === 409 ? 'busy' : 'failed' };
  });
  const edit = count.editOf('concentrate');
  const sold = data.fills.filter((f) => stock.bottles.some((b) => b.ml === f.ml));
  return (
    <Section title={w.concentrate}>
      <div className="grid gap-1" data-testid="concentrate" data-level={stock.level}>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-2xl leading-tight font-semibold tabular-nums">
            {ml(stock.concentrateMl)}
          </span>
          {stock.level !== 'ok' && (
            <LevelTag
              level={stock.level}
              text={stock.level === 'zero' ? w.levelZero : w.levelLow}
            />
          )}
        </p>
        <p className="text-small text-muted-foreground tabular-nums">
          {fill(w.reservedLine, {
            reserved: ml(stock.reservedMl),
            available: ml(stock.availableMl),
          })}
        </p>
        {stock.belowReserve && (
          <p className="text-small text-muted-foreground">{t.stock.belowNow}</p>
        )}
      </div>
      <dl
        className="grid grid-cols-3 gap-2 rounded-button bg-field px-4 py-3"
        data-testid="bottles"
      >
        <dt className="col-span-3 text-small font-medium text-muted-foreground">{w.bottles}</dt>
        {stock.bottles.map((b) => (
          <div key={b.ml} className="min-w-0" data-testid={`bottles-${b.ml}`}>
            <dt className="text-small text-muted-foreground">
              {fill(w.mlValue, { ml: String(b.ml) })}
            </dt>
            <dd className="font-semibold tabular-nums">{num(b.available)}</dd>
          </div>
        ))}
      </dl>
      <p className="max-w-[60ch] text-small text-pretty text-muted-foreground">
        {fill(w.fillHint, {
          fills: sold
            .map((f) => fill(w.fill, { ml: String(f.ml), fill: num(f.fillMl) }))
            .join(', '),
        })}
      </p>
      {edit ? (
        <CountEditor
          id="warehouse-concentrate"
          label={t.stock.newConcentrate}
          unit="ml"
          unitLabel={t.stock.consumables.units.ml}
          edit={edit}
          reserved={stock.reservedMl}
          saving={count.saving === 'concentrate'}
          t={t}
          {...count.handlers(row)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => count.open(row)}>
            {w.count.title}
          </Button>
          {count.savedKey === 'concentrate' && (
            <span role="status" className="inline-flex items-center gap-1 text-small">
              <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {w.count.done}
            </span>
          )}
        </div>
      )}
    </Section>
  );
}

function OilSection({ data, language, w }: { data: WarehouseFragrance; language: Language; w: W }) {
  const { stock } = data;
  const money = (n: number) => formatMoney(n, language);
  return (
    <Section title={w.oil}>
      <div className="grid gap-1" data-testid="oil" data-level={stock.oilLevel}>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-2xl leading-tight font-semibold tabular-nums">
            {fill(w.mlValue, { ml: num(stock.oilMl) })}
          </span>
          {stock.oilLevel !== 'ok' && (
            <LevelTag
              level={stock.oilLevel}
              text={stock.oilLevel === 'zero' ? w.oilZero : w.oilLow}
            />
          )}
        </p>
        <p className="font-medium tabular-nums">{fill(w.grams, { grams: num(stock.oilGrams) })}</p>
        <p className="max-w-[60ch] text-small text-pretty text-muted-foreground">
          {w.oilHint} {fill(w.lowHint, { n: num(data.lowConcentrateMl), oil: num(data.lowOilMl) })}
        </p>
      </div>
      {stock.value && (
        <dl className="grid gap-2 rounded-button bg-field px-4 py-3 text-sm">
          <dt className="text-small font-medium text-muted-foreground">{w.value}</dt>
          {(
            [
              [w.valueOil, stock.value.oil],
              [w.valueConcentrate, stock.value.concentrate],
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
              {stock.value.total === null ? '—' : money(stock.value.total)}
            </dd>
          </div>
          {stock.value.concentrate === null && (
            <p className="text-small text-pretty text-muted-foreground">{w.valueUnknown}</p>
          )}
        </dl>
      )}
    </Section>
  );
}

type MixingState =
  | { kind: 'idle' }
  | { kind: 'done'; ml: number }
  | { kind: 'oil'; needed: number; balance: number }
  | { kind: 'ethanol'; needed: number; balance: number }
  | { kind: 'invalid' | 'failed' | 'busy' };

/**
 * «Приготовить концентрат» (ADR 0043): the ml made; the preview is the server's per-ml shares times
 * the ml typed (no filling loss), against the oil and the ethanol on hand.
 */
function MixingSection({ data, t }: { data: WarehouseFragrance; t: AdminMessages }) {
  const w = t.warehouse;
  const m = w.mixing;
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<MixingState>({ kind: 'idle' });
  const ml = text.trim() === '' ? null : parseCount(text, 'ml', MAX_MIX_ML);
  const oil = ml === null ? 0 : round3(data.perMl.oilGrams * ml);
  const ethanol = ml === null ? 0 : Math.round(data.perMl.ethanolMl * ml);

  async function submit() {
    if (ml === null || ml <= 0) return setState({ kind: 'invalid' });
    setPending(true);
    const res = await browserApi.warehouse
      .mix({ params: { id: data.fragranceId }, body: { ml } })
      .catch(() => null);
    setPending(false);
    if (res?.status === 201) {
      setText('');
      setState({ kind: 'done', ml });
      router.refresh();
    } else if (res?.status === 409 && res.body.code === 'oil_short') {
      setState({
        kind: 'oil',
        needed: res.body.neededGrams ?? 0,
        balance: res.body.balanceGrams ?? 0,
      });
      router.refresh();
    } else if (res?.status === 409 && res.body.code === 'ethanol_short') {
      setState({
        kind: 'ethanol',
        needed: res.body.neededMl ?? 0,
        balance: res.body.balanceMl ?? 0,
      });
      router.refresh();
    } else setState({ kind: res?.status === 409 ? 'busy' : 'failed' });
  }

  return (
    <Section title={m.title}>
      <p className="-mt-2 max-w-[70ch] text-sm text-pretty text-muted-foreground">{m.text}</p>
      {data.ethanol === null && <Notice title={m.noEthanol} />}
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field id="mix-ml" label={m.ml} className="max-w-48">
          <Input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            className="tabular-nums"
            aria-invalid={state.kind === 'invalid' || undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setState({ kind: 'idle' });
            }}
          />
        </Field>
        {ml !== null && ml > 0 && (
          <p className="text-sm tabular-nums" aria-live="polite">
            <span className="font-medium">
              {fill(m.needs, { grams: num(oil), ethanol: num(ethanol) })}
            </span>
            <span className="text-muted-foreground">
              {' · '}
              {fill(m.left, {
                grams: num(round3(data.stock.oilGrams - oil)),
                ethanol: num((data.ethanol?.onHandMl ?? 0) - ethanol),
              })}
            </span>
          </p>
        )}
        {state.kind === 'oil' && (
          <Notice
            title={fill(m.oilShort, { needed: num(state.needed), balance: num(state.balance) })}
          />
        )}
        {state.kind === 'ethanol' && (
          <Notice
            title={fill(m.ethanolShort, { needed: num(state.needed), balance: num(state.balance) })}
          />
        )}
        {(state.kind === 'failed' || state.kind === 'busy') && (
          <Notice title={state.kind === 'busy' ? w.tryAgain : w.failed} />
        )}
        {state.kind === 'invalid' && (
          <p role="alert" className="text-alert text-xs font-medium">
            {m.invalid}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={pending}>
            {m.submit}
          </Button>
          {state.kind === 'done' && (
            <span role="status" className="inline-flex items-center gap-1.5 text-small">
              <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {fill(m.done, { ml: num(state.ml) })}
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
          <p role="alert" className="text-alert text-xs font-medium">
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
            <p role="alert" className="text-alert text-xs font-medium">
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
  m.bottles.map((b) => `${fill(w.mlValue, { ml: String(b.ml) })} ${signed(b.change)}`).join(', ');

/** The consumables of a move in the staff member's language: «Флакон 10 мл −2, Коробка 10 мл −2». */
const consumablesText = (list: StockMove['consumables'], language: Language) =>
  list.map((c) => `${language === 'uz' ? c.nameUz : c.nameRu} ${signed(c.change)}`).join(', ');

/** What a move could not take (it never stops a sale): «Не хватило: Коробка 10 мл 2». */
function shortText(m: StockMove, language: Language, w: W): string | null {
  if (!m.short) return null;
  const parts = [
    m.short.concentrateMl
      ? fill(w.history.shortConcentrate, { ml: num(m.short.concentrateMl) })
      : null,
    ...(m.short.consumables ?? []).map(
      (c) => `${language === 'uz' ? c.nameUz : c.nameRu} ${num(c.change)}`,
    ),
  ].filter(Boolean);
  return parts.length ? fill(w.history.short, { list: parts.join(', ') }) : null;
}

/** Where it came from: the order, the Uzum order, the set, the invoice, where a count was typed, a note. */
function documentText(m: StockMove, w: W, language: Language): string | null {
  if (m.orderNumber !== null) return fill(w.order, { number: String(m.orderNumber) });
  if (m.uzumOrder !== null) return fill(w.uzumOrder, { number: m.uzumOrder });
  // a set bottling (#79) or assembly (ADR 0043): that set's boxes
  if (m.set !== null)
    return fill(w.setBottling, { name: m.set.name[language], qty: String(m.set.quantity) });
  if (m.invoice !== null) return [m.supplier, m.invoice].filter(Boolean).join(', ');
  if (m.source !== null) return w.sources[m.source];
  return m.note;
}

/**
 * The warehouse history (ADR 0041, 0043), newest first: the fragrance's page and a consumable's
 * history share it. `withSubject` names each move's fragrance (a consumable's history spans many).
 */
export function HistoryList({
  history,
  language,
  w,
  withSubject = false,
}: {
  history: StockMove[];
  language: Language;
  w: W;
  withSubject?: boolean;
}) {
  const h = w.history;
  if (history.length === 0) return <p className="text-sm text-muted-foreground">{h.empty}</p>;
  const what = (m: StockMove) =>
    [
      m.oilGrams ? `${h.oil} ${signed(m.oilGrams)}` : null,
      m.concentrateMl ? `${h.concentrate} ${signed(m.concentrateMl)}` : null,
      bottlesText(m, w) || null,
      consumablesText(m.consumables, language) || null,
    ].filter(Boolean);
  const notes = (m: StockMove) =>
    [documentText(m, w, language), m.reason, shortText(m, language, w)].filter(Boolean);
  return (
    <>
      {/* phones and dialogs: one block per move */}
      <ul className={cn('-my-2 divide-y divide-border', !withSubject && 'md:hidden')}>
        {history.map((m) => (
          <li key={m.id} className="grid gap-0.5 py-3" data-testid={`move-${m.id}`}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold">{w.kinds[m.kind]}</span>
              <span className="text-small text-muted-foreground tabular-nums">
                {formatTashkent(m.at)}
              </span>
            </p>
            {withSubject && m.fragranceName && (
              <p className="text-sm [overflow-wrap:anywhere]">{m.fragranceName}</p>
            )}
            {what(m).length > 0 && <p className="text-sm tabular-nums">{what(m).join(' · ')}</p>}
            {notes(m).length > 0 && (
              <p className="text-small text-muted-foreground [overflow-wrap:anywhere]">
                {notes(m).join(' · ')}
              </p>
            )}
            <p className="text-small text-muted-foreground">{m.actorName ?? h.shop}</p>
          </li>
        ))}
      </ul>
      {!withSubject && (
        <div className="-mx-4 hidden sm:-mx-6 md:block">
          <Table>
            <THead>
              <TR>
                <TH>{h.when}</TH>
                <TH>{h.what}</TH>
                <TH className="text-right">{h.oil}</TH>
                <TH className="text-right">{h.concentrate}</TH>
                <TH>{h.bottles}</TH>
                <TH>{h.note}</TH>
                <TH>{h.who}</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((m) => {
                const doc = documentText(m, w, language);
                const consumed = consumablesText(m.consumables, language);
                const short = shortText(m, language, w);
                return (
                  <TR key={m.id} data-testid={`move-row-${m.id}`} className="align-top">
                    <TD className="h-auto py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatTashkent(m.at)}
                    </TD>
                    <TD className="h-auto py-2.5 font-medium">{w.kinds[m.kind]}</TD>
                    <TD className="h-auto py-2.5 text-right whitespace-nowrap tabular-nums">
                      {signed(m.oilGrams)}
                    </TD>
                    <TD className="h-auto py-2.5 text-right whitespace-nowrap tabular-nums">
                      {signed(m.concentrateMl)}
                    </TD>
                    <TD className="h-auto max-w-[16rem] py-2.5 tabular-nums">
                      {bottlesText(m, w) && <span className="block">{bottlesText(m, w)}</span>}
                      {consumed && (
                        <span className="block text-small text-muted-foreground">{consumed}</span>
                      )}
                    </TD>
                    <TD className="h-auto max-w-[22rem] py-2.5 [overflow-wrap:anywhere]">
                      {doc && <span className="block">{doc}</span>}
                      {m.reason && (
                        <span className="block text-small text-muted-foreground">{m.reason}</span>
                      )}
                      {short && <span className="block text-small font-medium">{short}</span>}
                    </TD>
                    <TD className="h-auto py-2.5 text-muted-foreground">{m.actorName ?? h.shop}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
      {history.length >= WAREHOUSE_HISTORY_LIMIT && (
        <p className="text-small text-muted-foreground">
          {fill(h.limit, { n: String(WAREHOUSE_HISTORY_LIMIT) })}
        </p>
      )}
    </>
  );
}

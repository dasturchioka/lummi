'use client';

import {
  STOCK_REASON_MAX,
  UZUM_ORDER_MAX,
  UZUM_SALE_LINES_MAX,
  UZUM_SALE_QTY_MAX,
  type UzumSale,
  type UzumSaleInput,
  type UzumSaleItem,
  type UzumSalesPage,
  type UzumShortLine,
} from '@lummi/contracts';
import { formatCalendarDate, formatMoney, type Language } from '@lummi/i18n';
import { Check, FileSpreadsheet, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { cn, fill } from '@/lib/utils';

type U = AdminMessages['uzum'];

/**
 * A line's item as the form keeps it: a volume (`v:<id>`), a Discovery set (`set:<vial ml>`), or
 * none.
 */
type LineDraft = { key: number; item: string; qty: string; price: string };
const blankLine = (key: number): LineDraft => ({ key, item: '', qty: '1', price: '' });

/** A typed whole number («69 000» too); null when it is not one. */
function whole(v: string): number | null {
  const s = v.replace(/\s/g, '');
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}
/** A typed percent («20,5»), 0–100 with two decimals at most; null when it is not one. */
function percent(v: string): number | null {
  const s = v.replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= 100 ? n : null;
}

/** What a sale's line or a short line names: «Rain Tea 10 мл», or a Discovery set by its vial ml. */
const itemName = (l: { name: string | null; ml: number }, u: U) =>
  l.name === null
    ? fill(u.setName, { ml: String(l.ml) })
    : `${l.name} ${fill(u.ml, { ml: String(l.ml) })}`;

/**
 * Uzum sales (#80): the form that records one (its bottles leave the shelf at once), the list of
 * recorded ones with their void, and the way to the Excel import. Every figure is the API's; the
 * form's revenue line only multiplies what was typed.
 */
export function UzumSalesView({
  data,
  owner,
  today,
  language,
  t,
}: {
  data: UzumSalesPage;
  owner: boolean;
  /** Tashkent's today, `YYYY-MM-DD`: the form's starting date and its latest. */
  today: string;
  language: Language;
  t: AdminMessages;
}) {
  const u = t.uzum;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <>
      <PageHeader
        title={u.title}
        description={u.description}
        actions={
          <Button asChild variant="outline">
            <Link href="/uzum/import">
              <FileSpreadsheet strokeWidth={1.5} aria-hidden />
              {u.importLink}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 lg:gap-5">
        <SaleForm data={data} today={today} language={language} u={u} />
        <Section title={u.list.title}>
          {data.sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">{u.list.empty}</p>
          ) : (
            <SalesList sales={data.sales} owner={owner} language={language} u={u} />
          )}
          <Pager
            page={data.page}
            pages={pages}
            href={(p) => (p > 1 ? `/uzum?page=${p}` : '/uzum')}
            labels={{
              prev: u.list.prev,
              next: u.list.next,
              page: fill(u.list.page, { page: String(data.page), pages: String(pages) }),
            }}
          />
        </Section>
      </div>
    </>
  );
}

type FormState =
  | { kind: 'idle' | 'done' | 'invalid' | 'duplicate' | 'failed' | 'busy' }
  | { kind: 'short'; short: UzumShortLine[] };

function SaleForm({
  data,
  today,
  language,
  u,
}: {
  data: UzumSalesPage;
  today: string;
  language: Language;
  u: U;
}) {
  const f = u.form;
  const router = useRouter();
  const [soldOn, setSoldOn] = useState(today);
  const [uzumOrder, setUzumOrder] = useState('');
  const [commission, setCommission] = useState(String(data.commissionPercent).replace('.', ','));
  const [lines, setLines] = useState<LineDraft[]>([blankLine(0)]);
  const [nextKey, setNextKey] = useState(1);
  const [state, setState] = useState<FormState>({ kind: 'idle' });
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  const touch = () => {
    if (state.kind !== 'idle') setState({ kind: 'idle' });
  };
  const setLine = (key: number, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setBad((b) => {
      const next = new Set(b);
      for (const k of Object.keys(patch)) next.delete(`${key}.${k}`);
      return next;
    });
    touch();
  };

  // the preview only: what was typed, multiplied; the server records its own figures
  const revenue = lines.reduce((sum, l) => {
    const q = whole(l.qty);
    const p = whole(l.price);
    return q !== null && p !== null ? sum + q * p : sum;
  }, 0);

  function read(): UzumSaleInput | null {
    const wrong = new Set<string>();
    const order = uzumOrder.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(soldOn) || soldOn > today) wrong.add('soldOn');
    if (order === '' || order.length > UZUM_ORDER_MAX) wrong.add('uzumOrder');
    const pct = percent(commission);
    if (pct === null) wrong.add('commission');
    const out: UzumSaleInput['lines'] = [];
    for (const l of lines) {
      const q = whole(l.qty);
      const p = whole(l.price);
      if (l.item === '') wrong.add(`${l.key}.item`);
      if (q === null || q < 1 || q > UZUM_SALE_QTY_MAX) wrong.add(`${l.key}.qty`);
      if (p === null || p < 1) wrong.add(`${l.key}.price`);
      if (l.item === '' || q === null || p === null) continue;
      out.push(
        l.item.startsWith('set:')
          ? { kind: 'discovery_set', vialMl: l.item === 'set:5' ? 5 : 10, qty: q, price: p }
          : { kind: 'volume', volumeId: Number(l.item.slice(2)), qty: q, price: p },
      );
    }
    setBad(wrong);
    if (wrong.size > 0) return null;
    return { soldOn, uzumOrder: order, commissionPercent: pct!, lines: out };
  }

  async function submit() {
    const body = read();
    if (!body) return setState({ kind: 'invalid' });
    setPending(true);
    const res = await browserApi.uzum.record({ body }).catch(() => null);
    setPending(false);
    if (res?.status === 201) {
      // the next sale is often the same day and commission
      setUzumOrder('');
      setLines([blankLine(nextKey)]);
      setNextKey((k) => k + 1);
      setState({ kind: 'done' });
      router.refresh();
    } else if (res?.status === 409 && res.body.code === 'stock_short') {
      setState({ kind: 'short', short: res.body.short ?? [] });
      router.refresh();
    } else if (res?.status === 409 && res.body.code === 'duplicate_order') {
      setBad(new Set(['uzumOrder']));
      setState({ kind: 'duplicate' });
    } else if (res?.status === 422) setState({ kind: 'invalid' });
    else setState({ kind: res?.status === 409 ? 'busy' : 'failed' });
  }

  const err = (key: string, text: string = f.required) => (bad.has(key) ? text : undefined);
  const items = data.items;
  const itemOptions: ComboboxOption[] = items.map((it) => ({
    value: optionValue(it),
    label:
      it.kind === 'volume'
        ? fill(f.itemOption, { name: it.name, ml: String(it.ml), n: num(it.available) })
        : fill(f.setOption, { ml: String(it.vialMl), n: num(it.available) }),
    muted: it.available <= 0,
  }));

  return (
    <Section title={f.title}>
      <form
        className="grid gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="uzum-sold-on" label={f.soldOn} error={err('soldOn')}>
            <Input
              type="date"
              max={today}
              value={soldOn}
              onChange={(e) => {
                setSoldOn(e.target.value);
                setBad((b) => new Set([...b].filter((k) => k !== 'soldOn')));
                touch();
              }}
            />
          </Field>
          <Field
            id="uzum-order"
            label={f.uzumOrder}
            error={state.kind === 'duplicate' ? f.duplicate : err('uzumOrder')}
          >
            <Input
              autoComplete="off"
              maxLength={UZUM_ORDER_MAX}
              value={uzumOrder}
              onChange={(e) => {
                setUzumOrder(e.target.value);
                setBad((b) => new Set([...b].filter((k) => k !== 'uzumOrder')));
                touch();
              }}
            />
          </Field>
          <Field
            id="uzum-commission"
            label={f.commission}
            hint={fill(f.commissionHint, { n: num(data.commissionPercent) })}
            error={err('commission', f.percent)}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              value={commission}
              onChange={(e) => {
                setCommission(e.target.value);
                setBad((b) => new Set([...b].filter((k) => k !== 'commission')));
                touch();
              }}
            />
          </Field>
        </div>

        <ol className="grid gap-3">
          {lines.map((l, i) => (
            <li
              key={l.key}
              className="grid gap-3 rounded-card bg-milk p-3 sm:grid-cols-[minmax(0,1fr)_7rem_10rem_auto] sm:items-start sm:bg-transparent sm:p-0"
              aria-label={fill(f.lineTitle, { n: String(i + 1) })}
            >
              <Field id={`uzum-line-${l.key}-item`} label={f.item} error={err(`${l.key}.item`)}>
                <Combobox
                  value={l.item}
                  onChange={(v) => setLine(l.key, { item: v })}
                  options={itemOptions}
                  placeholder={f.search}
                  emptyText={f.noMatch}
                />
              </Field>
              <Field
                id={`uzum-line-${l.key}-qty`}
                label={f.qty}
                error={err(`${l.key}.qty`, f.wholeNumber)}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className="tabular-nums"
                  value={l.qty}
                  onChange={(e) => setLine(l.key, { qty: e.target.value })}
                />
              </Field>
              <Field
                id={`uzum-line-${l.key}-price`}
                label={f.price}
                error={err(`${l.key}.price`, f.wholeNumber)}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="69 000"
                  className="tabular-nums"
                  value={l.price}
                  onChange={(e) => setLine(l.key, { price: e.target.value })}
                />
              </Field>
              {lines.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="justify-self-end sm:mt-[1.6rem]"
                  aria-label={fill(f.removeLine, { n: String(i + 1) })}
                  onClick={() => {
                    setLines((ls) => ls.filter((x) => x.key !== l.key));
                    touch();
                  }}
                >
                  <X strokeWidth={1.5} aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ol>
        <p className="-mt-2 text-xs text-muted-foreground">{f.priceHint}</p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={lines.length >= UZUM_SALE_LINES_MAX}
            onClick={() => {
              setLines((ls) => [...ls, blankLine(nextKey)]);
              setNextKey((k) => k + 1);
            }}
          >
            <Plus strokeWidth={1.5} aria-hidden />
            {f.addLine}
          </Button>
          {revenue > 0 && (
            <p className="text-sm font-semibold tabular-nums" aria-live="polite">
              {fill(f.revenue, { amount: formatMoney(revenue, language) })}
            </p>
          )}
        </div>

        {state.kind === 'short' && (
          <Notice title={f.short}>
            {state.short
              .map((s) =>
                fill(f.shortLine, {
                  item: itemName(s, u),
                  wanted: num(s.wanted),
                  available: num(s.available),
                }),
              )
              .join('; ')}
            . {f.shortHint}
          </Notice>
        )}
        {(state.kind === 'failed' || state.kind === 'busy') && (
          <Notice title={state.kind === 'busy' ? u.tryAgain : u.failed} />
        )}
        {state.kind === 'invalid' && (
          <p role="alert" className="text-xs font-medium">
            {f.invalid}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={pending}>
            {f.submit}
          </Button>
          {state.kind === 'done' && (
            <span role="status" className="inline-flex items-center gap-1.5 text-small">
              <Check className="size-4 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {f.done}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

const optionValue = (it: UzumSaleItem) =>
  it.kind === 'volume' ? `v:${it.volumeId}` : `set:${it.vialMl}`;

function SalesList({
  sales,
  owner,
  language,
  u,
}: {
  sales: UzumSale[];
  owner: boolean;
  language: Language;
  u: U;
}) {
  const l = u.list;
  const [voiding, setVoiding] = useState<UzumSale | null>(null);
  const money = (n: number) => formatMoney(n, language);
  const linesText = (s: UzumSale) =>
    s.lines.map((x) => fill(l.line, { item: itemName(x, u), qty: num(x.qty) })).join(', ');
  const profitText = (s: UzumSale) =>
    s.costs === null ? '—' : s.costs.profit ? money(s.costs.profit.profit) : l.noCost;
  const voidButton = (s: UzumSale) =>
    !s.voided && (
      <Button variant="outline" size="sm" onClick={() => setVoiding(s)}>
        {l.void}
      </Button>
    );
  const voidedLine = (s: UzumSale) =>
    s.voided && (
      <span className="block text-small text-muted-foreground [overflow-wrap:anywhere]">
        {fill(l.voided, { reason: s.voidReason ?? '' })}
      </span>
    );

  return (
    <>
      {/* phones: one block per sale */}
      <ul className="-my-2 divide-y divide-border md:hidden">
        {sales.map((s) => (
          <li
            key={s.id}
            className={cn('grid gap-1 py-3', s.voided && 'text-muted-foreground')}
            data-testid={`uzum-sale-${s.id}`}
          >
            <p className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold [overflow-wrap:anywhere]">{s.uzumOrder}</span>
              <span className={cn('font-semibold tabular-nums', s.voided && 'line-through')}>
                {money(s.revenue)}
              </span>
            </p>
            <p className="text-sm [overflow-wrap:anywhere]">{linesText(s)}</p>
            <p className="text-small text-muted-foreground">
              {[
                formatCalendarDate(s.soldOn, language),
                owner ? `${l.profit} ${profitText(s)}` : null,
                s.actorName,
                s.source === 'import' ? l.viaImport : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {voidedLine(s)}
            {!s.voided && <div className="pt-1">{voidButton(s)}</div>}
          </li>
        ))}
      </ul>
      <div className="-mx-4 hidden sm:-mx-6 md:block">
        <Table>
          <THead>
            <TR>
              <TH>{l.soldOn}</TH>
              <TH>{l.order}</TH>
              <TH>{l.lines}</TH>
              <TH className="text-right">{l.revenue}</TH>
              {owner && <TH className="text-right">{l.profit}</TH>}
              <TH>{l.who}</TH>
              <TH>
                <span className="sr-only">{l.void}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {sales.map((s) => (
              <TR
                key={s.id}
                className={cn(s.voided && 'text-muted-foreground')}
                data-testid={`uzum-sale-row-${s.id}`}
              >
                <TD className="whitespace-nowrap">{formatCalendarDate(s.soldOn, language)}</TD>
                <TD className="max-w-[12rem] [overflow-wrap:anywhere]">
                  <span className="block font-medium">{s.uzumOrder}</span>
                  {s.source === 'import' && (
                    <span className="block text-small text-muted-foreground">{l.viaImport}</span>
                  )}
                  {voidedLine(s)}
                </TD>
                <TD className="max-w-[22rem] [overflow-wrap:anywhere]">{linesText(s)}</TD>
                <TD
                  className={cn(
                    'text-right whitespace-nowrap tabular-nums',
                    s.voided && 'line-through',
                  )}
                >
                  {money(s.revenue)}
                </TD>
                {owner && (
                  <TD className="text-right whitespace-nowrap tabular-nums">{profitText(s)}</TD>
                )}
                <TD className="text-muted-foreground">{s.actorName ?? '—'}</TD>
                <TD className="text-right">{voidButton(s)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {voiding && <VoidDialog sale={voiding} onClose={() => setVoiding(null)} u={u} />}
    </>
  );
}

function VoidDialog({ sale, onClose, u }: { sale: UzumSale; onClose: () => void; u: U }) {
  const v = u.void;
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!reason.trim()) return;
    setPending(true);
    const res = await browserApi.uzum
      .void({ params: { id: sale.id }, body: { reason: reason.trim() } })
      .catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      onClose();
      router.refresh();
    } else if (res?.status === 409 && res.body.code === 'voided') setError(v.already);
    else setError(res?.status === 409 ? u.tryAgain : u.failed);
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle className="[overflow-wrap:anywhere]">
          {fill(v.title, { order: sale.uzumOrder })}
        </AlertDialogTitle>
        <AlertDialogDescription>{v.text}</AlertDialogDescription>
        <div className="mt-5 grid gap-3">
          <Field id={`uzum-void-${sale.id}-reason`} label={v.reason}>
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
            <Button variant="outline">{v.cancel}</Button>
          </AlertDialogCancel>
          <Button loading={pending} disabled={!reason.trim()} onClick={() => void confirm()}>
            {v.confirm}
          </Button>
        </DialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

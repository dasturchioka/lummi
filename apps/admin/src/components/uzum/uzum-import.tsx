'use client';

import {
  CATALOG_IMPORT_MIME,
  type UzumImportApplied,
  type UzumImportIssue,
  type UzumImportReport,
} from '@lummi/contracts';
import { formatCalendarDate, formatMoney, type Language } from '@lummi/i18n';
import { ArrowLeft, CircleCheck, FileSpreadsheet, Info } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
import { TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

type State =
  | { kind: 'idle' | 'busy' }
  | { kind: 'report'; file: File; report: UzumImportReport }
  | { kind: 'applied'; applied: UzumImportApplied }
  | { kind: 'error'; text: string };

/**
 * Uzum sales from an Excel file (#80), the catalog import's way: download the template, upload the
 * file; the dry run lists the sales it holds, the rows to fix and the orders already recorded;
 * «Записать продажи» is offered only for a clean file, asks once, and writes all or nothing.
 */
export function UzumImport({ language, t }: { language: Language; t: AdminMessages }) {
  const u = t.uzum;
  const x = u.import;
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, language);

  const issueText = (i: UzumImportIssue) => {
    const p = i.params ?? {};
    const item =
      i.code === 'stock_short'
        ? p.ml === '' || p.ml === undefined
          ? u.set
          : `${p.name} ${fill(u.ml, { ml: String(p.ml) })}`
        : '';
    const text = fill(x.issues[i.code], {
      ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])),
      item,
    });
    const where = [
      i.row !== null ? fill(x.row, { row: String(i.row) }) : null,
      i.column ? `«${i.column}»` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return where ? `${where}: ${text}` : text;
  };

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return setState({ kind: 'error', text: x.notXlsx });
    setApplyError(null);
    setState({ kind: 'busy' });
    const res = await fetch('/api/admin/uzum/import/dry-run', {
      method: 'POST',
      headers: { 'content-type': CATALOG_IMPORT_MIME },
      body: file,
    }).catch(() => null);
    if (res?.ok) setState({ kind: 'report', file, report: (await res.json()) as UzumImportReport });
    else if (res?.status === 413) setState({ kind: 'error', text: x.tooBig });
    else if (res?.status === 415) setState({ kind: 'error', text: x.notXlsx });
    else setState({ kind: 'error', text: x.failed });
  };

  const apply = async () => {
    if (state.kind !== 'report' || !state.report.token) return;
    setApplying(true);
    setApplyError(null);
    const res = await fetch(`/api/admin/uzum/import/apply?token=${state.report.token}`, {
      method: 'POST',
      headers: { 'content-type': CATALOG_IMPORT_MIME },
      body: state.file,
    }).catch(() => null);
    setApplying(false);
    setConfirming(false);
    if (res?.ok) {
      setState({ kind: 'applied', applied: (await res.json()) as UzumImportApplied });
      return;
    }
    if (res?.status === 422) {
      // refused at write time (the stock moved since the check): nothing written; show why
      const body = (await res.json().catch(() => null)) as { report?: UzumImportReport } | null;
      if (body?.report) return setState({ kind: 'report', file: state.file, report: body.report });
    }
    setApplyError(res?.status === 409 ? x.stale : x.failed);
  };

  return (
    <>
      <PageHeader
        title={x.title}
        description={x.description}
        actions={
          <Link href="/uzum" className={cn(TEXT_LINK, 'inline-flex items-center gap-1.5')}>
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
            {x.back}
          </Link>
        }
      />
      <div className="grid gap-4">
        <Section title={x.templateTitle}>
          <p className="max-w-[64ch] text-sm text-pretty text-muted-foreground">{x.templateHint}</p>
          <div>
            <Button asChild variant="outline">
              <a href="/api/admin/uzum/import/template" download>
                <FileSpreadsheet strokeWidth={1.5} aria-hidden />
                {x.templateBtn}
              </a>
            </Button>
          </div>
        </Section>

        <Section title={x.uploadTitle}>
          <p className="max-w-[64ch] text-sm text-pretty text-muted-foreground">{x.uploadHint}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label={x.choose}
              data-testid="uzum-file"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <Button
              variant={state.kind === 'report' ? 'outline' : 'default'}
              loading={state.kind === 'busy'}
              onClick={() => input.current?.click()}
            >
              {state.kind === 'report' ? x.replace : x.choose}
            </Button>
            {state.kind === 'busy' && (
              <span role="status" className="text-sm text-muted-foreground">
                {x.checking}
              </span>
            )}
            {state.kind === 'report' && (
              <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                {state.file.name}
              </span>
            )}
          </div>
          {state.kind === 'error' && <Notice title={state.text} />}
          {applyError && <Notice title={applyError} />}
        </Section>

        {state.kind === 'report' && (
          <Section title={x.reportTitle}>
            <Report
              report={state.report}
              x={x}
              language={language}
              money={money}
              issueText={issueText}
            />
            {state.report.token && (
              <div>
                <Button onClick={() => setConfirming(true)}>{x.apply}</Button>
              </div>
            )}
          </Section>
        )}

        {state.kind === 'applied' && (
          <Card className="grid gap-4 p-4 sm:p-6" data-testid="uzum-applied">
            <div className="flex items-start gap-3">
              <CircleCheck className="mt-px size-5 shrink-0" strokeWidth={1.5} aria-hidden />
              <div>
                <p className="font-semibold leading-snug">{x.appliedTitle}</p>
                <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
                  {fill(x.applied, {
                    n: num(state.applied.recorded),
                    units: num(state.applied.units),
                    revenue: money(state.applied.revenue),
                  })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/uzum">{x.back}</Link>
              </Button>
              <Button variant="outline" onClick={() => setState({ kind: 'idle' })}>
                {x.again}
              </Button>
            </div>
          </Card>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={(o) => !applying && setConfirming(o)}>
        <AlertDialogContent>
          <AlertDialogTitle>{x.applyTitle}</AlertDialogTitle>
          <AlertDialogDescription>{x.applyBody}</AlertDialogDescription>
          <DialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={applying}>
                {x.cancel}
              </Button>
            </AlertDialogCancel>
            <Button loading={applying} onClick={() => void apply()}>
              {applying ? x.applying : x.apply}
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type X = AdminMessages['uzum']['import'];

function Report({
  report,
  x,
  language,
  money,
  issueText,
}: {
  report: UzumImportReport;
  x: X;
  language: Language;
  money: (n: number) => string;
  issueText: (i: UzumImportIssue) => string;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm font-medium tabular-nums">
        {report.saleTotal > 0
          ? fill(x.summary, {
              sales: num(report.saleTotal),
              units: num(report.units),
              revenue: money(report.revenue),
            })
          : x.nothing}
      </p>
      {report.errorTotal > 0 && (
        <Notice title={x.errorsTitle}>
          <span className="grid gap-1">
            {report.errors.map((e, i) => (
              <span key={i} className="block [overflow-wrap:anywhere]">
                {issueText(e)}
              </span>
            ))}
            {report.errorTotal > report.errors.length && (
              <span className="block">
                {fill(x.more, { n: num(report.errorTotal - report.errors.length) })}
              </span>
            )}
          </span>
        </Notice>
      )}
      {report.warningTotal > 0 && (
        <div
          role="status"
          className="flex gap-3 rounded-button bg-sage-wash px-4 py-3.5 text-foreground"
        >
          <Info className="mt-px size-5 shrink-0 text-sage-ink" strokeWidth={1.5} aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold leading-snug">
              {fill(x.skipped, { n: num(report.skipped) })}
            </p>
            <p className="mt-1 grid gap-0.5 text-[13px] text-muted-foreground">
              {report.warnings.map((w, i) => (
                <span key={i} className="block [overflow-wrap:anywhere]">
                  {issueText(w)}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}
      {report.sales.length > 0 && (
        <div className="-mx-4 sm:-mx-6">
          <Table>
            <THead>
              <TR>
                <TH>{x.rowsHead}</TH>
                <TH>{x.orderHead}</TH>
                <TH>{x.dateHead}</TH>
                <TH className="text-right">{x.unitsHead}</TH>
                <TH className="text-right">{x.revenueHead}</TH>
                <TH className="text-right">{x.commissionHead}</TH>
              </TR>
            </THead>
            <TBody>
              {report.sales.map((s) => (
                <TR key={s.uzumOrder}>
                  <TD className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {s.rows.join(', ')}
                  </TD>
                  <TD className="max-w-[14rem] font-medium [overflow-wrap:anywhere]">
                    {s.uzumOrder}
                  </TD>
                  <TD className="whitespace-nowrap">{formatCalendarDate(s.soldOn, language)}</TD>
                  <TD className="text-right tabular-nums">{num(s.units)}</TD>
                  <TD className="text-right whitespace-nowrap tabular-nums">{money(s.revenue)}</TD>
                  <TD className="text-right whitespace-nowrap tabular-nums">
                    {num(s.commissionPercent)}&nbsp;%
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

'use client';

import type { ImportApplied, ImportIssue, ImportReport } from '@lummi/contracts';
import { CATALOG_IMPORT_MIME } from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { ArrowLeft, CircleCheck, Download, FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
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
  DialogFooter,
} from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { TEXT_LINK } from '@/lib/ui-classes';
import { fill } from '@/lib/utils';

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'report'; file: File; report: ImportReport }
  | { kind: 'applied'; counts: ImportApplied['counts']; warnings: ImportIssue[] }
  | { kind: 'error'; text: string };

/**
 * Catalog import and export through the Excel template (#26). Download the file, upload it:
 * the dry run reports counts, errors by sheet / row / column, and stock warnings; «Применить» is
 * offered only for a clean report and asks for a confirmation. The server refuses a plan the
 * catalog has moved past since the dry run, and writes all or nothing.
 */
export function ExcelImport({ language, t }: { language: Language; t: AdminMessages }) {
  const x = t.catalog.excel;
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const fieldLabel = (f: string) => {
    const key = f.replace(/^volumes\.\d+\./, '') as keyof typeof x.fields;
    return x.fields[f as keyof typeof x.fields] ?? x.fields[key] ?? f;
  };
  const issueText = (i: ImportIssue) =>
    fill(
      x.issues[i.code as keyof typeof x.issues] ?? x.issues.invalid,
      Object.fromEntries(
        Object.entries(i.params ?? {}).map(([k, v]) => [
          k,
          k === 'fields'
            ? String(v)
                .split(', ')
                .filter(Boolean)
                .map(fieldLabel)
                .join(', ')
            : String(v),
        ]),
      ),
    );

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return setState({ kind: 'error', text: x.notXlsx });
    setState({ kind: 'busy' });
    const res = await fetch('/api/admin/catalog/import/dry-run', {
      method: 'POST',
      headers: { 'content-type': CATALOG_IMPORT_MIME },
      body: file,
    }).catch(() => null);
    if (res?.ok) setState({ kind: 'report', file, report: (await res.json()) as ImportReport });
    else if (res?.status === 413) setState({ kind: 'error', text: x.tooBig });
    else if (res?.status === 415) setState({ kind: 'error', text: x.notXlsx });
    else setState({ kind: 'error', text: x.failed });
  };

  const apply = async () => {
    if (state.kind !== 'report' || !state.report.token) return;
    setApplying(true);
    setApplyError(null);
    const res = await fetch(`/api/admin/catalog/import/apply?token=${state.report.token}`, {
      method: 'POST',
      headers: { 'content-type': CATALOG_IMPORT_MIME },
      body: state.file,
    }).catch(() => null);
    setApplying(false);
    if (res?.ok) {
      setConfirming(false);
      const done = (await res.json()) as ImportApplied;
      setState({ kind: 'applied', counts: done.counts, warnings: done.warnings ?? [] });
      return;
    }
    setConfirming(false);
    if (res?.status === 409) setApplyError(x.stale);
    else if (res?.status === 422) {
      // the file was refused at write time: nothing written; show why, keep the report
      const body = (await res.json().catch(() => null)) as { report?: ImportReport } | null;
      if (body?.report) setState({ kind: 'report', file: state.file, report: body.report });
      else setApplyError(x.failed);
    } else setApplyError(x.failed);
  };

  const reset = () => {
    setState({ kind: 'idle' });
    setApplyError(null);
  };

  return (
    <>
      <PageHeader
        title={x.title}
        description={x.description}
        actions={
          <Link href="/catalog" className={`${TEXT_LINK} inline-flex items-center gap-1.5`}>
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
            {x.back}
          </Link>
        }
      />

      <div className="grid gap-4">
        <Section title={x.downloadTitle}>
          <p className="max-w-[64ch] text-sm text-pretty text-muted-foreground">{x.downloadHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href="/api/admin/catalog/export" download>
                <Download strokeWidth={1.5} aria-hidden />
                {x.exportBtn}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/api/admin/catalog/template" download>
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
              data-testid="excel-file"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <Button
              variant={state.kind === 'idle' || state.kind === 'error' ? 'default' : 'outline'}
              loading={state.kind === 'busy'}
              onClick={() => input.current?.click()}
            >
              {state.kind === 'idle' || state.kind === 'error' ? x.choose : x.replace}
            </Button>
            {state.kind === 'busy' && (
              <span role="status" className="text-sm text-muted-foreground">
                {x.checking}
              </span>
            )}
            {state.kind === 'report' && (
              <span className="text-sm text-muted-foreground">{state.file.name}</span>
            )}
          </div>
          {state.kind === 'error' && <Notice title={state.text} />}
          {applyError && <Notice title={applyError} />}
        </Section>

        {state.kind === 'report' && (
          <Report
            report={state.report}
            language={language}
            x={x}
            issueText={issueText}
            onApply={() => setConfirming(true)}
          />
        )}

        {state.kind === 'applied' && (
          <Card className="grid gap-4 p-4 sm:p-6" data-testid="excel-applied">
            <div className="flex items-start gap-3">
              <CircleCheck className="mt-px size-5 shrink-0" strokeWidth={1.5} aria-hidden />
              <div>
                <p className="font-semibold leading-snug">{x.appliedTitle}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{x.appliedHint}</p>
              </div>
            </div>
            <Counts counts={state.counts} x={x} />
            {state.warnings.length > 0 && (
              <div className="grid gap-2" data-testid="excel-applied-warnings">
                <Notice title={x.warnedTitle}>{x.warnedHint}</Notice>
                <ul className="list-disc pl-9 text-sm text-pretty">
                  {state.warnings.map((w, i) => (
                    <li key={i}>{issueText(w)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Button variant="outline" onClick={reset}>
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
              {applying ? x.applying : x.applyConfirm}
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Counts({ counts, x }: { counts: ImportReport['counts']; x: AdminMessages['catalog']['excel'] }) {
  const rows: [string, { new: number; changed: number; unchanged?: number; notInFile?: number }][] = [
    [x.rowFragrances, counts.fragrances],
    [x.rowVolumes, counts.volumes],
    [x.rowFamilies, counts.families],
    [x.rowNotes, counts.notes],
  ];
  return (
    <Card className="overflow-hidden bg-milk p-0">
      <Table>
        <THead>
          <TR>
            <TH />
            <TH className="text-right">{x.cNew}</TH>
            <TH className="text-right">{x.cChanged}</TH>
            <TH className="text-right">{x.cUnchanged}</TH>
            <TH className="text-right">{x.cNotInFile}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map(([label, c]) => (
            <TR key={label}>
              <TD className="font-medium">{label}</TD>
              <TD className="text-right">{c.new}</TD>
              <TD className="text-right">{c.changed}</TD>
              <TD className="text-right">{c.unchanged ?? '—'}</TD>
              <TD className="text-right">{c.notInFile ?? '—'}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function Report({
  report,
  language,
  x,
  issueText,
  onApply,
}: {
  report: ImportReport;
  language: Language;
  x: AdminMessages['catalog']['excel'];
  issueText: (i: ImportIssue) => string;
  onApply: () => void;
}) {
  const clean = report.errorTotal === 0;
  const negatives = report.stock.filter((s) => s.negative);
  return (
    <Section title={x.reportTitle} className="gap-4">
      <div data-testid="excel-report" className="grid gap-4">
        {clean ? (
          <div className="flex items-center gap-3">
            <Badge tone="sage">{x.cleanTitle}</Badge>
            <span className="text-[13px] text-muted-foreground">{x.nothingWritten}</span>
          </div>
        ) : (
          <>
            <Notice
              title={fill(x.errorsTitle, {
                count: plural(language, report.errorTotal, x.errorsWord),
              })}
            >
              {x.errorsHint}
            </Notice>
            {/* phones: each problem is a block, where it is (sheet · row · column) over what is wrong */}
            <ul className="grid gap-2 sm:hidden" data-testid="excel-errors-list">
              {report.errors.map((e, i) => (
                <li key={i} className="rounded-button bg-milk px-4 py-3 text-sm">
                  <p className="text-[12.5px] text-muted-foreground">
                    {[x.sheets[e.sheet], e.row ? `${x.colRow} ${e.row}` : null, e.column]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1 text-pretty">{issueText(e)}</p>
                </li>
              ))}
            </ul>
            <Card className="hidden overflow-hidden bg-milk p-0 sm:block">
              <Table>
                <THead>
                  <TR>
                    <TH>{x.colSheet}</TH>
                    <TH>{x.colRow}</TH>
                    <TH>{x.colColumn}</TH>
                    <TH>{x.colProblem}</TH>
                  </TR>
                </THead>
                <TBody>
                  {report.errors.map((e, i) => (
                    <TR key={i}>
                      <TD className="whitespace-nowrap">{x.sheets[e.sheet]}</TD>
                      <TD>{e.row ?? '—'}</TD>
                      <TD className="min-w-32">{e.column ?? '—'}</TD>
                      <TD className="min-w-56 whitespace-normal text-pretty">{issueText(e)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
            {report.errorTotal > report.errors.length && (
              <p className="text-[13px] text-muted-foreground">
                {fill(x.cappedHint, {
                  shown: String(report.errors.length),
                  total: String(report.errorTotal),
                })}
              </p>
            )}
          </>
        )}

        {clean && <Counts counts={report.counts} x={x} />}

        {clean && negatives.length > 0 && (
          <Notice title={x.warningsTitle}>{x.warningsHint}</Notice>
        )}

        {clean && report.stock.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-[13px] font-medium text-muted-foreground">{x.stockTitle}</h3>
            <Card className="max-h-96 overflow-auto bg-milk p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>{x.colAroma}</TH>
                    <TH>{x.colMl}</TH>
                    <TH className="text-right">{x.colOnHand}</TH>
                    <TH className="text-right">{x.colNew}</TH>
                    <TH className="text-right">{x.colReserve}</TH>
                    <TH className="text-right">{x.colAvailable}</TH>
                  </TR>
                </THead>
                <TBody>
                  {report.stock.map((s) => (
                    <TR key={`${s.code}-${s.ml}`} data-negative={s.negative || undefined}>
                      <TD className="min-w-40 font-medium">{s.name}</TD>
                      <TD>{s.ml}</TD>
                      <TD className="text-right">{s.onHand ?? x.newVolume}</TD>
                      <TD className="text-right">{s.newOnHand}</TD>
                      <TD className="text-right">{s.reserved}</TD>
                      <TD className="text-right font-semibold">
                        {s.available}
                        {s.negative && (
                          <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-foreground" />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          </div>
        )}

        {clean && (
          <div>
            <Button onClick={onApply} data-testid="excel-apply">
              {x.apply}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

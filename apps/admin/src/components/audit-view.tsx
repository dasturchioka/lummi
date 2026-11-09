import { settingKeys, settingMeta, type AuditEntryDto, type SettingKey } from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { AuditFiltersForm, type AuditFilters } from '@/components/audit-filters';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { displayValue, formatTashkent, num, pick } from '@/lib/setting-copy';
import { describeInput } from '@/lib/setting-input';
import { QUIET_ACTION } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';

export type { AuditFilters };

type Props = {
  t: AdminMessages;
  language: Language;
  items: AuditEntryDto[];
  total: number;
  page: number;
  pageSize: number;
  filters: AuditFilters;
  options: {
    actions: string[];
    actors: { value: string; type: AuditEntryDto['actorType']; name: string | null }[];
  };
};

const knownKey = (id: string | null): id is SettingKey =>
  id !== null && (settingKeys as string[]).includes(id);

/** Readable action name; a code a later ticket adds shows as the code itself until it is labelled. */
const actionLabel = (t: AdminMessages, code: string) =>
  (t.audit.actions as Record<string, string>)[code] ?? code;
const targetLabel = (t: AdminMessages, type: string) =>
  (t.audit.targets as Record<string, string>)[type] ?? type;

function who(t: AdminMessages, e: AuditEntryDto): string {
  if (e.actorType === 'staff') return e.actorName ?? t.audit.actors.unknownStaff;
  if (e.actorType === 'customer') return e.actorName ?? t.audit.actors.customer;
  return t.audit.actors[e.actorType];
}

/** What the entry touched: a setting by its label, anything else by type and id. */
function Target({ t, language, e }: { t: AdminMessages; language: Language; e: AuditEntryDto }) {
  if (e.targetType === 'setting' && knownKey(e.targetId)) {
    return <>{pick(settingMeta(e.targetId).label, language)}</>;
  }
  return (
    <>
      {targetLabel(t, e.targetType)}
      {e.targetId ? ` ${e.targetId}` : ''}
    </>
  );
}

/**
 * A setting change reads "old → new" in the setting's own units (so'm through `formatMoney`), the
 * old value in Muted Ink; the words «было» / «стало» stay for screen readers. The raw payload
 * sits behind «Подробнее».
 */
function Details({ t, language, e }: { t: AdminMessages; language: Language; e: AuditEntryDto }) {
  const { payload } = e;
  const change =
    e.action === 'setting.changed' && knownKey(e.targetId) && 'old' in payload && 'new' in payload
      ? (() => {
          const spec = describeInput(settingMeta(e.targetId).schema);
          const show = (v: unknown) => displayValue(e.targetId as SettingKey, spec, v, language, t);
          return (
            <p className="break-words">
              <span className="sr-only">{t.audit.was} </span>
              <span className="text-muted-foreground">{show(payload.old)}</span>
              <ArrowRight
                className="mx-1.5 inline size-3.5 -translate-y-px text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
              <span className="sr-only">{t.audit.became} </span>
              <span className="font-medium">{show(payload.new)}</span>
            </p>
          );
        })()
      : null;
  const raw = Object.keys(payload).length === 0 ? null : JSON.stringify(payload, null, 2);
  return (
    <div className="grid min-w-0 gap-1">
      {change}
      {raw && (
        <details className="group text-[13px]">
          <summary
            className={cn(
              'inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-sm select-none [&::-webkit-details-marker]:hidden',
              QUIET_ACTION,
            )}
          >
            <ChevronRight
              className="size-3.5 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
              strokeWidth={1.75}
              aria-hidden
            />
            {t.audit.more}
          </summary>
          <pre className="mt-1 max-h-72 max-w-full overflow-auto rounded-button bg-field p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {raw}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * The audit trail: the filters (a GET form), the count, the entries newest first (rows on phones,
 * a table on wide screens) and numbered pages. Times are Asia/Tashkent.
 */
export function AuditView({ t, language, items, total, page, pageSize, filters, options }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(filters.actor || filters.action || filters.from || filters.to);
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `/audit?${s}` : '/audit';
  };
  const actorLabel = (a: Props['options']['actors'][number]) =>
    a.type === 'staff' ? (a.name ?? a.value) : t.audit.actors[a.type];
  const pageText = fill(t.audit.page, { page: num(page), pages: num(pages) });

  return (
    <>
      <PageHeader title={t.audit.title} description={t.audit.description} />

      <AuditFiltersForm
        t={t}
        filters={filters}
        actors={options.actors.map((a) => ({ value: a.value, label: actorLabel(a) }))}
        actions={options.actions.map((a) => ({ value: a, label: actionLabel(t, a) }))}
      />

      {items.length === 0 ? (
        <EmptyState
          title={filtered ? t.audit.emptyFiltered : t.audit.empty}
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/audit">{t.audit.filters.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {filtered ? t.audit.emptyFilteredText : null}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {fill(plural(language, total, t.audit.total), { total: num(total) })}
          </p>
          <ul className="divide-y divide-border @4xl:hidden">
            {items.map((e) => (
              <li key={e.id} className="grid grid-cols-1 gap-1 px-4 py-4 @xl:px-5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 leading-snug font-semibold [overflow-wrap:anywhere]">
                    {actionLabel(t, e.action)}
                  </span>
                  <time
                    dateTime={e.createdAt}
                    className="shrink-0 text-small text-muted-foreground tabular-nums"
                  >
                    {formatTashkent(e.createdAt)}
                  </time>
                </div>
                <MetaLine
                  className="text-small text-muted-foreground [overflow-wrap:anywhere]"
                  parts={[who(t, e), <Target key="target" t={t} language={language} e={e} />]}
                />
                <div className="mt-1 text-[13px]">
                  <Details t={t} language={language} e={e} />
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH className="w-px">{t.audit.when}</TH>
                  <TH>{t.audit.who}</TH>
                  <TH>{t.audit.what}</TH>
                  <TH>{t.audit.target}</TH>
                  <TH>{t.audit.details}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((e) => (
                  <TR key={e.id} className="[&>td]:py-3 [&>td]:align-top">
                    <TD className="whitespace-nowrap text-muted-foreground tabular-nums">
                      <time dateTime={e.createdAt}>{formatTashkent(e.createdAt)}</time>
                    </TD>
                    <TD className="min-w-[9rem] break-words">{who(t, e)}</TD>
                    <TD className="min-w-[9rem] font-semibold [overflow-wrap:anywhere]">
                      {actionLabel(t, e.action)}
                    </TD>
                    <TD className="min-w-[9rem] [overflow-wrap:anywhere]">
                      <Target t={t} language={language} e={e} />
                    </TD>
                    <TD className="w-[34%] min-w-[14rem]">
                      <Details t={t} language={language} e={e} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {pages > 1 && (
        <nav
          aria-label={pageText}
          className="mt-4 flex items-center justify-between gap-3 text-small text-muted-foreground"
        >
          <PageLink href={page > 1 ? href(page - 1) : null}>
            <ChevronLeft strokeWidth={1.5} aria-hidden />
            {t.audit.prev}
          </PageLink>
          <span className="text-center tabular-nums">{pageText}</span>
          <PageLink href={page < pages ? href(page + 1) : null}>
            {t.audit.next}
            <ChevronRight strokeWidth={1.5} aria-hidden />
          </PageLink>
        </nav>
      )}
    </>
  );
}

/** Previous / next; at either end it stays in place, disabled, so the row never jumps. */
function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  ) : (
    <Button variant="outline" size="sm" disabled>
      {children}
    </Button>
  );
}

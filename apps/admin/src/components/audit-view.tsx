import { settingKeys, settingMeta, type AuditEntryDto, type SettingKey } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { displayValue, formatTashkent, pick } from '@/lib/setting-copy';
import { describeInput } from '@/lib/setting-input';
import { fill } from '@/lib/utils';

export type AuditFilters = { actor?: string; action?: string; from?: string; to?: string };

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

/** A setting change reads "было → стало" in the setting's own units; the raw payload sits behind «Подробнее». */
function Details({ t, language, e }: { t: AdminMessages; language: Language; e: AuditEntryDto }) {
  const { payload } = e;
  const change =
    e.action === 'setting.changed' && knownKey(e.targetId) && 'old' in payload && 'new' in payload
      ? (() => {
          const spec = describeInput(settingMeta(e.targetId).schema);
          const show = (v: unknown) => displayValue(e.targetId as SettingKey, spec, v, language, t);
          return (
            <span className="[overflow-wrap:anywhere]">
              <span className="text-muted-foreground">{t.audit.was}</span> {show(payload.old)}{' '}
              <span className="text-muted-foreground">{t.audit.became}</span> {show(payload.new)}
            </span>
          );
        })()
      : null;
  const raw = Object.keys(payload).length === 0 ? null : JSON.stringify(payload, null, 2);
  return (
    <div className="grid gap-1">
      {change}
      {raw && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">{t.audit.more}</summary>
          <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap rounded-button bg-field p-2 font-mono text-xs [overflow-wrap:anywhere]">
            {raw}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * The audit trail: a plain GET form for the filters (the URL is the state, so a filtered view can
 * be linked and the page needs no client code) and numbered pages. Times are Asia/Tashkent.
 */
export function AuditView({ t, language, items, total, page, pageSize, filters, options }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(filters.actor || filters.action || filters.from || filters.to);
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `/audit?${s}` : '/audit';
  };
  const actorLabel = (a: Props['options']['actors'][number]) =>
    a.type === 'staff' ? (a.name ?? a.value) : t.audit.actors[a.type];

  return (
    <>
      <PageHeader title={t.audit.title} description={t.audit.description} />

      <Card className="mb-4 p-4 lg:p-5">
        <form
          method="get"
          action="/audit"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end"
        >
          <FilterField id="f-actor" label={t.audit.filters.actor}>
            <Select id="f-actor" name="actor" defaultValue={filters.actor ?? ''}>
              <option value="">{t.audit.filters.all}</option>
              {options.actors.map((a) => (
                <option key={a.value} value={a.value}>
                  {actorLabel(a)}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField id="f-action" label={t.audit.filters.action}>
            <Select id="f-action" name="action" defaultValue={filters.action ?? ''}>
              <option value="">{t.audit.filters.all}</option>
              {options.actions.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(t, a)}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField id="f-from" label={t.audit.filters.from}>
            <Input id="f-from" type="date" name="from" defaultValue={filters.from ?? ''} />
          </FilterField>
          <FilterField id="f-to" label={t.audit.filters.to}>
            <Input id="f-to" type="date" name="to" defaultValue={filters.to ?? ''} />
          </FilterField>
          <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
            <Button type="submit" className="max-sm:flex-1">
              {t.audit.filters.apply}
            </Button>
            {filtered && (
              <Button asChild variant="outline" className="max-sm:flex-1">
                <Link href="/audit">{t.audit.filters.reset}</Link>
              </Button>
            )}
          </div>
        </form>
        {badRange && <Notice title={t.audit.badRange} className="mt-3" />}
      </Card>

      {items.length === 0 ? (
        <EmptyState title={filtered ? t.audit.emptyFiltered : t.audit.empty} />
      ) : (
        <Card className="@container">
          <ul className="divide-y divide-border @4xl:hidden">
            {items.map((e) => (
              <li key={e.id} className="grid gap-1 px-4 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold [overflow-wrap:anywhere]">
                    {actionLabel(t, e.action)}
                  </span>
                  <time
                    dateTime={e.createdAt}
                    className="text-[13px] text-muted-foreground tabular-nums"
                  >
                    {formatTashkent(e.createdAt)}
                  </time>
                </div>
                <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                  {who(t, e)} · <Target t={t} language={language} e={e} />
                </p>
                <div className="text-[13px]">
                  <Details t={t} language={language} e={e} />
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{t.audit.when}</TH>
                  <TH>{t.audit.who}</TH>
                  <TH>{t.audit.what}</TH>
                  <TH>{t.audit.target}</TH>
                  <TH>{t.audit.details}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">{formatTashkent(e.createdAt)}</TD>
                    <TD className="[overflow-wrap:anywhere]">{who(t, e)}</TD>
                    <TD className="font-semibold [overflow-wrap:anywhere]">
                      {actionLabel(t, e.action)}
                    </TD>
                    <TD className="[overflow-wrap:anywhere]">
                      <Target t={t} language={language} e={e} />
                    </TD>
                    <TD className="max-w-[28rem] py-3">
                      <Details t={t} language={language} e={e} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      <nav
        aria-label={fill(t.audit.page, { page: String(page), pages: String(pages) })}
        className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
      >
        <span>{fill(t.audit.total, { total: String(total) })}</span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            {fill(t.audit.page, { page: String(page), pages: String(pages) })}
          </span>
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page - 1)}>
                <ChevronLeft strokeWidth={1.5} aria-hidden />
                {t.audit.prev}
              </Link>
            </Button>
          ) : null}
          {page < pages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page + 1)}>
                {t.audit.next}
                <ChevronRight strokeWidth={1.5} aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      </nav>
    </>
  );
}

function FilterField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

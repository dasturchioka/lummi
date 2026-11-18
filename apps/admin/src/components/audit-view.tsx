import { settingKeys, settingMeta, type AuditEntryDto, type SettingKey } from '@lummi/contracts';
import { plural, type Language } from '@lummi/i18n';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { AuditFiltersForm, type AuditFilters } from '@/components/audit-filters';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { CodeText } from '@/components/promo/code-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetaLine } from '@/components/ui/meta-line';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { displayValue, formatTashkent, num, pick } from '@/lib/setting-copy';
import { describeInput } from '@/lib/setting-input';
import { describeAudit, humanise } from '@/lib/audit-describe';
import { fill } from '@/lib/utils';

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
export const actionLabel = (t: AdminMessages, code: string) =>
  (t.audit.actions as Record<string, string>)[code] ?? `${t.audit.what}: ${humanise(code)}`;
const targetLabel = (t: AdminMessages, type: string) =>
  (t.audit.targets as Record<string, string>)[type] ?? `${t.audit.target}: ${humanise(type)}`;

export function who(t: AdminMessages, e: AuditEntryDto): string {
  if (e.actorType === 'staff') return e.actorName ?? t.audit.actors.unknownStaff;
  if (e.actorType === 'customer') return e.actorName ?? t.audit.actors.customer;
  return t.audit.actors[e.actorType];
}

/**
 * What the entry touched: a setting by its label, a staff member by name (as the actor is shown),
 * anything else by type and id.
 */
function Target({ t, language, e }: { t: AdminMessages; language: Language; e: AuditEntryDto }) {
  if (e.targetType === 'setting' && knownKey(e.targetId)) {
    return <>{pick(settingMeta(e.targetId).label, language)}</>;
  }
  if (e.targetType === 'staff') return <>{e.targetName ?? t.audit.actors.unknownStaff}</>;
  // a promo code by its code, which every promo entry carries (a deleted one has no page to open)
  if (e.targetType === 'promo_code' && typeof e.payload.code === 'string')
    return (
      <>
        {targetLabel(t, e.targetType)}{' '}
        <span className="font-medium tracking-[0.04em]">
          <CodeText code={e.payload.code} />
        </span>
      </>
    );
  // a banner, fragrance or volume by its name (the API looks it up), an order by its number
  const named = (language === 'uz' ? (e.targetNameUz ?? e.targetName) : e.targetName) || null;
  if (named)
    return (
      <>
        {targetLabel(t, e.targetType)} «{named}»
      </>
    );
  if (e.targetType === 'order' && typeof e.payload.number === 'number')
    return (
      <>
        {targetLabel(t, e.targetType)} №{'\u00a0'}
        {e.payload.number}
      </>
    );
  return (
    <>
      {targetLabel(t, e.targetType)}
      {e.targetId ? ` ${e.targetId}` : ''}
    </>
  );
}

/** A shop card as its audit entry keeps it: the masked number and the holder. */
function cardText(t: AdminMessages, v: unknown): string {
  if (v && typeof v === 'object' && 'number' in v && 'holder' in v)
    // the number stays on one line; the line may break before the holder
    return `${String(v.number).replace(/ /g, '\u00a0')} · ${String(v.holder)}`;
  return t.shopCard.noneTitle;
}

/**
 * A setting change reads "old → new" in the setting's own units (so'm through `formatMoney`), the
 * old value in Muted Ink; the words «было» / «стало» stay for screen readers. Every other action
 * reads as short lines (`describeAudit`).
 */
export function Details({
  t,
  language,
  e,
}: {
  t: AdminMessages;
  language: Language;
  e: AuditEntryDto;
}) {
  const { payload } = e;
  const pair = ((): [string, string] | null => {
    if (
      e.action === 'setting.changed' &&
      knownKey(e.targetId) &&
      'old' in payload &&
      'new' in payload
    ) {
      const spec = describeInput(settingMeta(e.targetId).schema);
      const show = (v: unknown) => displayValue(e.targetId as SettingKey, spec, v, language, t);
      return [show(payload.old), show(payload.new)];
    }
    if (e.action === 'shop_card.changed' || e.action === 'shop_card.cleared') {
      // the API keeps the number masked (`9860 •••• •••• 1234`); no card reads «Карта не указана»
      return [cardText(t, payload.old), cardText(t, payload.new)];
    }
    return null;
  })();
  const change = pair ? (
    <p className="break-words">
      <span className="sr-only">{t.audit.was} </span>
      <span className="text-muted-foreground">{pair[0]}</span>
      <ArrowRight
        className="mx-1.5 inline size-3.5 -translate-y-px text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
      <span className="sr-only">{t.audit.became} </span>
      <span className="font-medium">{pair[1]}</span>
    </p>
  ) : null;
  const lines = describeAudit(t, language, e);
  return (
    <div className="grid min-w-0 gap-1">
      {change}
      {lines.map((line, i) => (
        <p key={i} className="break-words [overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
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
                  parts={[
                    who(t, e),
                    // a sign-in names the actor twice: the object is the same person
                    !(
                      e.targetType === 'staff' &&
                      e.actorType === 'staff' &&
                      e.targetId === String(e.actorId)
                    ) && <Target key="target" t={t} language={language} e={e} />,
                  ]}
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

      <Pager
        page={page}
        pages={pages}
        href={href}
        labels={{ prev: t.audit.prev, next: t.audit.next, page: pageText }}
      />
    </>
  );
}

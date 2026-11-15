import {
  REVIEW_REQUEST_STATES,
  type AdminReviewRequestDto,
  type AdminReviewRequestsPageDto,
} from '@lummi/contracts';
import { formatPhone, type Language } from '@lummi/i18n';
import Link from 'next/link';
import { countOf } from '@/components/broadcasts/format';
import { EmptyState } from '@/components/empty-state';
import { ListFilters } from '@/components/list-filters';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetaLine } from '@/components/ui/meta-line';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { formatTashkent, num } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';
import { ReviewsTabs } from './reviews-tabs';

export type RequestFilters = { state?: string; from?: string; to?: string };

const TONE = { answered: 'sage', sent: 'live', not_delivered: 'neutral' } as const;

/**
 * The review requests the bot made (#55, TZ §5 L341): one row per order asked, with what came of
 * it: sent, answered (with the rating) or «не доставлено» (the customer had blocked the bot). The
 * three counts follow the days filter; the state filter is a GET form like the reviews' own.
 */
export function RequestsList({
  t,
  language,
  data,
  filters,
}: {
  t: AdminMessages;
  language: Language;
  data: AdminReviewRequestsPageDto;
  filters: RequestFilters;
}) {
  const m = t.reviews.requests;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const active = Object.values(filters).filter(Boolean).length;
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const href = (p: number) => listHref('/reviews/requests', filters, p);

  const state = (r: AdminReviewRequestDto) => (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={TONE[r.state]}>{m.states[r.state]}</Badge>
      {r.rating !== null && (
        <span className="text-small text-muted-foreground tabular-nums">
          {fill(m.rating, { rating: String(r.rating) })}
        </span>
      )}
    </span>
  );
  const order = (r: AdminReviewRequestDto) => (
    <Link
      href={`/orders/${r.orderNumber}`}
      className="font-semibold whitespace-nowrap underline-offset-[3px] hover:underline"
    >
      {fill(t.reviews.order, { number: String(r.orderNumber) })}
    </Link>
  );
  const who = (r: AdminReviewRequestDto) => (
    <MetaLine
      className="text-small text-muted-foreground"
      parts={[
        <span key="n" className="text-foreground">
          {r.customerName}
        </span>,
        r.phone && (
          <span key="p" className="whitespace-nowrap">
            {formatPhone(r.phone)}
          </span>
        ),
      ]}
    />
  );
  const when = (r: AdminReviewRequestDto) => (
    <time dateTime={r.requestedAt} className="whitespace-nowrap">
      {formatTashkent(r.requestedAt)}
    </time>
  );

  return (
    <>
      <PageHeader title={t.reviews.title} description={m.description} />
      <ReviewsTabs t={t} current="requests" />

      <Card className="mb-4">
        <dl
          aria-label={m.countsLabel}
          className="grid grid-cols-3 gap-3 px-4 py-3 text-small @xl:px-5"
        >
          {REVIEW_REQUEST_STATES.map((s) => (
            <div key={s} className="min-w-0">
              <dt className="text-muted-foreground [overflow-wrap:anywhere]">{m.states[s]}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{num(data.counts[s])}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <ListFilters
        action="/reviews/requests"
        active={active}
        labels={m.filters}
        warning={badRange ? m.badRange : undefined}
      >
        <Field id="f-state" label={m.filters.state}>
          <Select name="state" defaultValue={filters.state ?? ''}>
            <option value="">{m.filters.all}</option>
            {REVIEW_REQUEST_STATES.map((s) => (
              <option key={s} value={s}>
                {m.states[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-from" label={m.filters.from}>
          <Input type="date" name="from" defaultValue={filters.from ?? ''} />
        </Field>
        <Field id="f-to" label={m.filters.to}>
          <Input type="date" name="to" defaultValue={filters.to ?? ''} />
        </Field>
      </ListFilters>

      {data.items.length === 0 ? (
        <EmptyState
          title={active > 0 ? m.emptyFiltered : m.empty}
          action={
            active > 0 ? (
              <Button asChild variant="outline">
                <Link href="/reviews/requests">{m.filters.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {active > 0 ? m.emptyFilteredText : m.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {countOf(language, data.total, m.total)}
          </p>
          <ul className="divide-y divide-border @3xl:hidden">
            {data.items.map((r) => (
              <li key={r.orderNumber} className="grid gap-2 px-4 py-4 @xl:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  {order(r)}
                  <span className="text-small text-muted-foreground tabular-nums">{when(r)}</span>
                </div>
                {who(r)}
                {state(r)}
              </li>
            ))}
          </ul>
          <div className="hidden @3xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{m.columns.order}</TH>
                  <TH>{m.columns.customer}</TH>
                  <TH>{m.columns.requested}</TH>
                  <TH>{m.columns.state}</TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((r) => (
                  <TR key={r.orderNumber}>
                    <TD className="w-px whitespace-nowrap">{order(r)}</TD>
                    <TD className="min-w-[14rem]">{who(r)}</TD>
                    <TD className="w-px whitespace-nowrap text-muted-foreground">{when(r)}</TD>
                    <TD className="w-px whitespace-nowrap">{state(r)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      <Pager
        page={data.page}
        pages={pages}
        href={href}
        labels={{
          prev: t.reviews.prev,
          next: t.reviews.next,
          page: fill(t.reviews.page, { page: num(data.page), pages: num(pages) }),
        }}
      />
    </>
  );
}

import {
  BIRTHDAY_DELIVERY_FILTERS,
  BIRTHDAY_USED_FILTERS,
  type AdminBirthdayCouponDto,
  type AdminBirthdayCouponsPageDto,
} from '@lummi/contracts';
import { formatLocalDate, lastDayOf } from '@lummi/contracts';
import { formatCalendarDate, formatMoney, formatPhone, type Language } from '@lummi/i18n';
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
import { MetaLine } from '@/components/ui/meta-line';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { formatTashkent, num } from '@/lib/setting-copy';
import { fill } from '@/lib/utils';

export type BirthdayFilters = { year?: string; delivery?: string; used?: string };

/**
 * The owner's birthday coupons (#55, TZ §3.8 L195), newest issue first: who, for which birthday
 * year, the terms fixed at issue, whether the message reached the customer («не доставлено» when
 * the bot was blocked; the coupon stays in the profile), the order that used it and its expiry.
 * Rows on phones, a table from 768 px of the card. Read-only.
 */
export function BirthdayList({
  t,
  language,
  data,
  filters,
}: {
  t: AdminMessages;
  language: Language;
  data: AdminBirthdayCouponsPageDto;
  filters: BirthdayFilters;
}) {
  const m = t.birthdayCoupons;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const active = Object.values(filters).filter(Boolean).length;
  const href = (p: number) => listHref('/birthday-coupons', filters, p);

  const who = (c: AdminBirthdayCouponDto) => (
    <>
      <Link
        href={`/customers/${c.customerId}`}
        className="font-semibold [overflow-wrap:anywhere] underline-offset-[3px] hover:underline"
      >
        {c.customerName}
      </Link>
      {c.phone && (
        <span className="mt-0.5 block text-small whitespace-nowrap text-muted-foreground">
          {formatPhone(c.phone)}
        </span>
      )}
    </>
  );
  const terms = (c: AdminBirthdayCouponDto) =>
    fill(m.discount, { percent: String(c.percent), max: formatMoney(c.maxAmount, language) });
  const delivery = (c: AdminBirthdayCouponDto) => (
    <Badge tone={c.delivered ? 'sage' : 'look'}>
      {c.delivered ? m.delivery.delivered : m.delivery.notDelivered}
    </Badge>
  );
  const order = (c: AdminBirthdayCouponDto) =>
    c.usedOrderNumber === null ? (
      <span className="text-muted-foreground">{m.none}</span>
    ) : (
      <Link
        href={`/orders/${c.usedOrderNumber}`}
        className="font-semibold whitespace-nowrap underline-offset-[3px] hover:underline"
      >
        {fill(m.orderNo, { number: String(c.usedOrderNumber) })}
      </Link>
    );
  const issued = (c: AdminBirthdayCouponDto) => (
    <time dateTime={c.issuedAt} className="whitespace-nowrap">
      {formatTashkent(c.issuedAt)}
    </time>
  );
  /** «до 23 ноября 2026»: the last day it works (the instant is 00:00 the day after). */
  const until = (c: AdminBirthdayCouponDto) =>
    fill(m.until, {
      date: formatCalendarDate(formatLocalDate(lastDayOf(new Date(c.expiresAt))), language, true),
    });
  const expires = (c: AdminBirthdayCouponDto) => (
    <>
      <span>{until(c)}</span>
      <span className="block text-small text-muted-foreground">{m.states[c.state]}</span>
    </>
  );

  return (
    <>
      <PageHeader title={m.title} description={m.description} />

      <ListFilters action="/birthday-coupons" active={active} labels={m.filters}>
        <Field id="f-year" label={m.filters.year}>
          <Select name="year" defaultValue={filters.year ?? ''}>
            <option value="">{m.filters.all}</option>
            {data.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-delivery" label={m.filters.delivery}>
          <Select name="delivery" defaultValue={filters.delivery ?? ''}>
            <option value="">{m.filters.all}</option>
            {BIRTHDAY_DELIVERY_FILTERS.map((d) => (
              <option key={d} value={d}>
                {d === 'delivered' ? m.filters.delivered : m.filters.notDelivered}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="f-used" label={m.filters.used}>
          <Select name="used" defaultValue={filters.used ?? ''}>
            <option value="">{m.filters.all}</option>
            {BIRTHDAY_USED_FILTERS.map((u) => (
              <option key={u} value={u}>
                {u === 'used' ? m.filters.usedYes : m.filters.usedNo}
              </option>
            ))}
          </Select>
        </Field>
      </ListFilters>

      {data.items.length === 0 ? (
        <EmptyState
          title={active > 0 ? m.emptyFiltered : m.empty}
          action={
            active > 0 ? (
              <Button asChild variant="outline">
                <Link href="/birthday-coupons">{m.filters.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {active > 0 ? m.emptyFilteredText : m.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            <span>{countOf(language, data.total, m.total)}</span>
            {data.notDelivered > 0 && (
              <span className="font-semibold text-foreground">
                {fill(m.notDelivered, { n: num(data.notDelivered) })}
              </span>
            )}
          </p>
          <ul className="divide-y divide-border @3xl:hidden">
            {data.items.map((c) => (
              <li key={c.id} className="grid gap-2 px-4 py-4 @xl:px-5">
                <div className="min-w-0">{who(c)}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {delivery(c)}
                  <span className="text-small text-muted-foreground tabular-nums">
                    {m.columns.year}: {c.birthdayYear}
                  </span>
                </div>
                <MetaLine
                  className="text-small text-muted-foreground tabular-nums"
                  parts={[
                    <span key="t" className="font-medium text-foreground">
                      {terms(c)}
                    </span>,
                    <span key="i">
                      {m.columns.issued} {issued(c)}
                    </span>,
                    <span key="o">
                      {m.columns.order}: {order(c)}
                    </span>,
                    <span key="e">{until(c)}</span>,
                  ]}
                />
                <p className="text-small font-medium">{m.states[c.state]}</p>
              </li>
            ))}
          </ul>
          <div className="hidden @3xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{m.columns.customer}</TH>
                  <TH>{m.columns.discount}</TH>
                  <TH>{m.columns.issued}</TH>
                  <TH>{m.columns.delivery}</TH>
                  <TH>{m.columns.order}</TH>
                  <TH>{m.columns.expires}</TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((c) => (
                  <TR key={c.id} className="[&>td]:py-3 [&>td]:align-top">
                    <TD className="min-w-[10rem]">
                      {who(c)}
                      <span className="mt-0.5 block text-small text-muted-foreground tabular-nums">
                        {m.columns.year}: {c.birthdayYear}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap">{terms(c)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {formatTashkent(c.issuedAt).split('\u00a0')[0]}
                    </TD>
                    <TD className="w-px">{delivery(c)}</TD>
                    <TD>{order(c)}</TD>
                    <TD className="min-w-[9rem]">{expires(c)}</TD>
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
          prev: m.prev,
          next: m.next,
          page: fill(m.page, { page: num(data.page), pages: num(pages) }),
        }}
      />
    </>
  );
}

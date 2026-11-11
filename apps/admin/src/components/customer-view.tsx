import type { AdminCustomerDetail } from '@lummi/contracts';
import { formatMoney, formatPhone, type Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { CustomerBirthDate } from '@/components/customer-birth-date';
import { BlockedBadge, TelegramLink } from '@/components/customers-view';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent, num } from '@/lib/setting-copy';
import { TEXT_LINK } from '@/lib/ui-classes';
import { fill } from '@/lib/utils';

/**
 * One customer: who they are and every order they placed, newest first. The admin order page
 * is #33, so the number is plain text until it exists.
 */
export function CustomerView({
  t,
  language,
  customer,
  isOwner,
}: {
  t: AdminMessages;
  language: Language;
  customer: AdminCustomerDetail;
  /** The date of birth's «Исправить» is the owner's (TZ §3.8). */
  isOwner: boolean;
}) {
  const c = t.customers;
  const status = ordersMessages[language].orders.status;
  const facts: [string, React.ReactNode][] = [
    [c.telegram, <TelegramLink key="tg" c={customer} t={t} />],
    [
      c.phone,
      customer.phone ? (
        formatPhone(customer.phone)
      ) : (
        <span className="text-muted-foreground">{c.noPhone}</span>
      ),
    ],
    [c.language, customer.language.toUpperCase()],
    [
      c.birthDate,
      <CustomerBirthDate
        key="birth"
        id={customer.id}
        birthDate={customer.birthDate}
        canEdit={isOwner && customer.phone !== null}
        language={language}
        t={t}
      />,
    ],
    [c.orders, num(customer.ordersCount)],
    [c.spent, formatMoney(customer.totalSpent, language)],
  ];
  return (
    <>
      <Link href="/customers" className={`${TEXT_LINK} mb-4 inline-flex items-center gap-1`}>
        <ChevronLeft className="size-4" strokeWidth={1.5} aria-hidden />
        {c.back}
      </Link>
      <PageHeader
        title={customer.name}
        actions={customer.botBlocked ? <BlockedBadge t={t} /> : undefined}
      />
      <Card className="mb-6 p-4 sm:p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-small text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-semibold [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">{c.spentHint}</p>
      </Card>

      <h2 className="mb-3 font-display text-[13px] leading-[1.35] tracking-[0.2em] uppercase">
        {c.ordersTitle}
      </h2>
      {customer.orders.length === 0 ? (
        <EmptyState title={c.ordersEmpty} />
      ) : (
        <Card className="@container">
          <Table>
            <THead>
              <TR>
                <TH>{c.orderNo}</TH>
                <TH>{c.date}</TH>
                <TH>{c.status}</TH>
                <TH className="text-right">{c.sum}</TH>
              </TR>
            </THead>
            <TBody>
              {customer.orders.map((o) => (
                <TR key={o.id} data-testid={`order-row-${o.number}`}>
                  <TD className="font-semibold whitespace-nowrap" title={c.orderLinkSoon}>
                    {fill(c.orderNumber, { number: String(o.number) })}
                  </TD>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    <time dateTime={o.createdAt}>{formatTashkent(o.createdAt)}</time>
                  </TD>
                  <TD>{status[o.status]}</TD>
                  <TD className="text-right font-semibold whitespace-nowrap">
                    {formatMoney(o.total, language)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}

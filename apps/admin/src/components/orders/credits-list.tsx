'use client';

import { CREDIT_LINK_FILTERS, type AdminCreditDto } from '@lummi/contracts';
import { formatTiyin, plural, type Language } from '@lummi/i18n';
import { SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pager } from '@/components/pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AdminMessages } from '@/lib/i18n';
import { formatTashkent, num } from '@/lib/setting-copy';
import { TEXT_LINK } from '@/lib/ui-classes';
import { listHref } from '@/lib/list-page';
import { cn, fill } from '@/lib/utils';
import { MarkCreditDialog, UnmarkCreditDialog, type MarkResult } from './credit-mark-dialogs';
import { LinkCreditDialog } from './link-credit-dialog';

export type CreditFilters = { linked?: string; amount?: string; from?: string; to?: string };

type Props = {
  t: AdminMessages;
  language: Language;
  items: AdminCreditDto[];
  total: number;
  page: number;
  pageSize: number;
  filters: CreditFilters;
  /** The «Не для заказа» note's limit (the setting `payments.creditMarkNoteMaxLength`). */
  noteMax: number;
};

/**
 * «Поступления» (#33): every Humo credit, newest first, with the order it paid, «Не привязано»,
 * or «Не для заказа» with who marked it, when and their note (#49). The amount is exact to the
 * tiyin; a credit with tiyin, or one to another card, says why it can never pay an order on its
 * own. A free credit offers «Привязать к заказу» and «Не для заказа»; a marked one «Вернуть в
 * поступления».
 */
export function CreditsList({
  t,
  language,
  items,
  total,
  page,
  pageSize,
  filters,
  noteMax,
}: Props) {
  const c = t.credits;
  const f = c.filters;
  const router = useRouter();
  const [linking, setLinking] = useState<AdminCreditDto | null>(null);
  const [marking, setMarking] = useState<AdminCreditDto | null>(null);
  const [unmarking, setUnmarking] = useState<AdminCreditDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = [filters.linked, filters.amount, filters.from, filters.to].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const hidden = !open && 'max-sm:hidden';
  const badRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => listHref('/credits', filters, p);

  const amount = (it: AdminCreditDto) => (
    <span className="font-semibold whitespace-nowrap tabular-nums">
      {formatTiyin(it.amountTiyin, language)}
    </span>
  );
  /** Why this credit cannot pay an order by itself, if it cannot. */
  const caveat = (it: AdminCreditDto) =>
    [!it.onShopCard && c.otherCard, it.amountSom === null && c.withTiyin].filter((x): x is string =>
      Boolean(x),
    );
  /** The order it paid, «Не для заказа», or «Не привязано». */
  const status = (it: AdminCreditDto) =>
    it.order ? (
      <Link href={`/orders/${it.order.number}`} className={cn(TEXT_LINK, 'whitespace-nowrap')}>
        {fill(c.order, { number: String(it.order.number) })}
      </Link>
    ) : it.notForOrder ? (
      <Badge>{c.notForOrder}</Badge>
    ) : (
      <Badge>{c.unlinked}</Badge>
    );
  /** Who marked it «Не для заказа» and when, then their note. */
  const markInfo = (it: AdminCreditDto) =>
    it.notForOrder && (
      <div className="grid gap-0.5 text-small" data-credit-mark={it.id}>
        <p className="text-muted-foreground tabular-nums">
          {fill(c.markedBy, {
            name: it.notForOrder.by.name ?? t.audit.actors.unknownStaff,
            at: formatTashkent(it.notForOrder.at),
          })}
        </p>
        {it.notForOrder.note && (
          <p className="[overflow-wrap:anywhere] whitespace-pre-line">{it.notForOrder.note}</p>
        )}
      </div>
    );
  /**
   * A free credit: «Привязать к заказу» (outline) and the quieter «Не для заказа». A marked one:
   * «Вернуть в поступления». Left-aligned with the row's content; they wrap on a narrow row.
   */
  const actions = (it: AdminCreditDto) => {
    if (it.order) return null;
    const start = (dialog: (credit: AdminCreditDto) => void) => () => {
      setNotice(null);
      dialog(it);
    };
    return (
      <div className="flex flex-wrap gap-2 justify-self-start">
        {it.notForOrder ? (
          <Button
            variant="outline"
            size="sm"
            onClick={start(setUnmarking)}
            data-unmark-credit={it.id}
          >
            {c.unmarkAction}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={start(setLinking)}
              data-link-credit={it.id}
            >
              {c.linkAction}
            </Button>
            <Button variant="ghost" size="sm" onClick={start(setMarking)} data-mark-credit={it.id}>
              {c.markAction}
            </Button>
          </>
        )}
      </div>
    );
  };
  /** A mark or an unmark ended: say how, and reload the list either way. */
  const marked = (result: MarkResult) => {
    setMarking(null);
    setUnmarking(null);
    setNotice(
      { marked: c.marked, unmarked: c.unmarked, taken: c.markTaken, changed: c.markChanged }[
        result
      ],
    );
    router.refresh();
  };
  /** Why it cannot pay an order by itself, as chips: another card, tiyin in the amount. */
  const chips = (it: AdminCreditDto) => {
    const why = caveat(it);
    return why.length === 0 ? null : (
      <div className="flex flex-wrap gap-1.5">
        {why.map((x) => (
          <Badge key={x}>{x}</Badge>
        ))}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.description}
        actions={
          <Link href="/orders" className={TEXT_LINK}>
            {c.toOrders}
          </Link>
        }
      />

      <Card className="mb-4 p-4 lg:p-5">
        <form
          method="get"
          action="/credits"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end"
        >
          <div className="flex gap-2 sm:hidden">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              aria-expanded={open}
              aria-controls="c-linked c-amount c-from c-to"
              onClick={() => setOpen((v) => !v)}
            >
              <SlidersHorizontal strokeWidth={1.5} aria-hidden />
              {f.toggle}
              {active > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                  {active}
                </span>
              )}
            </Button>
            {active > 0 && (
              <Button asChild variant="outline" className="flex-1">
                <Link href="/credits">{f.reset}</Link>
              </Button>
            )}
          </div>
          <Field id="c-linked" label={f.linked} className={cn(hidden)}>
            <Select name="linked" defaultValue={filters.linked ?? 'all'}>
              {CREDIT_LINK_FILTERS.map((l) => (
                <option key={l} value={l}>
                  {c.link[l]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="c-amount" label={f.amount} className={cn(hidden)}>
            <Input
              name="amount"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={filters.amount ?? ''}
              placeholder="149 000"
            />
          </Field>
          <Field id="c-from" label={f.from} className={cn(hidden)}>
            <Input type="date" name="from" defaultValue={filters.from ?? ''} />
          </Field>
          <Field id="c-to" label={f.to} className={cn(hidden)}>
            <Input type="date" name="to" defaultValue={filters.to ?? ''} />
          </Field>
          <div className={cn('flex gap-2 sm:col-span-2 lg:col-span-1 lg:justify-end', hidden)}>
            <Button type="submit" className="max-sm:flex-1">
              {f.apply}
            </Button>
            {active > 0 && (
              <Button asChild variant="outline" className="max-sm:hidden">
                <Link href="/credits">{f.reset}</Link>
              </Button>
            )}
          </div>
        </form>
        {badRange && <Notice title={t.orders.badRange} className="mt-3" />}
      </Card>

      {notice !== null && <Notice title={notice} className="mb-4" />}

      {items.length === 0 ? (
        <EmptyState
          title={active > 0 ? c.emptyFiltered : c.empty}
          action={
            active > 0 ? (
              <Button asChild variant="outline">
                <Link href="/credits">{f.reset}</Link>
              </Button>
            ) : undefined
          }
        >
          {active > 0 ? c.emptyFilteredText : c.emptyText}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {fill(plural(language, total, c.total), { total: num(total) })}
          </p>
          <ul className="divide-y divide-border @3xl:hidden">
            {items.map((it) => (
              <li key={it.id} className="grid gap-1.5 px-4 py-4 @xl:px-5" data-credit={it.id}>
                <div className="flex items-baseline justify-between gap-3">
                  {amount(it)}
                  {status(it)}
                </div>
                <MetaLine
                  className="text-small text-muted-foreground tabular-nums"
                  parts={[
                    <time key="at" dateTime={it.occurredAt} className="whitespace-nowrap">
                      {formatTashkent(it.occurredAt)}
                    </time>,
                    <span key="card" className="whitespace-nowrap">
                      {it.cardMask}
                    </span>,
                    it.counterparty && (
                      <span key="from" className="[overflow-wrap:anywhere]">
                        {it.counterparty}
                      </span>
                    ),
                  ]}
                />
                {chips(it)}
                {markInfo(it)}
                {actions(it)}
              </li>
            ))}
          </ul>
          <div className="hidden @3xl:block">
            <Table>
              <THead>
                <TR>
                  <TH className="w-px">{c.columns.when}</TH>
                  <TH className="w-px text-right">{c.columns.amount}</TH>
                  <TH>{c.columns.card}</TH>
                  <TH>{c.columns.source}</TH>
                  <TH className="w-px">{c.columns.order}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((it) => (
                  <TR key={it.id} className="[&>td]:py-3 [&>td]:align-top" data-credit={it.id}>
                    <TD className="whitespace-nowrap text-muted-foreground tabular-nums">
                      <time dateTime={it.occurredAt}>{formatTashkent(it.occurredAt)}</time>
                    </TD>
                    <TD className="text-right">
                      {amount(it)}
                      {it.amountSom === null && (
                        <span className="mt-1 flex justify-end">
                          <Badge>{c.withTiyin}</Badge>
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {it.cardMask}
                      {!it.onShopCard && (
                        <span className="mt-1 flex">
                          <Badge>{c.otherCard}</Badge>
                        </span>
                      )}
                    </TD>
                    <TD className="min-w-[10rem] text-muted-foreground [overflow-wrap:anywhere]">
                      {it.counterparty}
                    </TD>
                    <TD>
                      <div
                        className={cn(
                          'grid justify-items-start gap-1.5',
                          !it.order && 'min-w-[17rem] max-w-[22rem]',
                        )}
                      >
                        {status(it)}
                        {markInfo(it)}
                        {actions(it)}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      {linking && (
        <LinkCreditDialog
          key={linking.id}
          credit={linking}
          t={t}
          language={language}
          onOpenChange={(open) => !open && setLinking(null)}
          onLinked={(number) => {
            setLinking(null);
            setNotice(fill(c.linked, { number: String(number) }));
            router.refresh();
          }}
        />
      )}

      {marking && (
        <MarkCreditDialog
          key={marking.id}
          credit={marking}
          noteMax={noteMax}
          t={t}
          language={language}
          onOpenChange={(open) => !open && setMarking(null)}
          onDone={marked}
        />
      )}

      {unmarking && (
        <UnmarkCreditDialog
          key={unmarking.id}
          credit={unmarking}
          t={t}
          language={language}
          onOpenChange={(open) => !open && setUnmarking(null)}
          onDone={marked}
        />
      )}

      <Pager
        page={page}
        pages={pages}
        href={href}
        labels={{
          prev: t.orders.prev,
          next: t.orders.next,
          page: fill(t.orders.page, { page: num(page), pages: num(pages) }),
        }}
      />
    </>
  );
}

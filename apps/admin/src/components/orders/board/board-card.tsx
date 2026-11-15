'use client';

import { useDraggable } from '@dnd-kit/core';
import type { AdminBoardCardDto, OrderStatus } from '@lummi/contracts';
import { formatMoney, plural, type Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Ellipsis, Gift } from 'lucide-react';
import Link from 'next/link';
import type { MouseEvent, TouchEvent } from 'react';
import { MetaLine } from '@/components/ui/meta-line';
import { age } from '@/lib/home-format';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { secondsIn } from './board-state';

/** Money on the board: the no-break space between groups, which reads at every weight. */
export const boardMoney = (n: number, language: Language) =>
  formatMoney(n, language).replace(/\u202f/g, '\u00a0');

type Marker = 'unpaid' | 'checking' | 'manual_review' | 'paid' | 'refund_owed';

/** Where the order's money stands, in one word; a paid order that ended owes its money back. */
const markerOf = (card: AdminBoardCardDto): Marker =>
  card.refundOwed ? 'refund_owed' : card.payment;

/**
 * The payment marker: a 7 px dot and a word. Paid is the Sage dot (Sage confirms); unpaid a hollow
 * faint ring; a receipt the AI is checking a Stone dot; what waits for a person (a receipt in
 * manual review, money to send back) a Graphite ring with the word in Ink 600, as the Home's
 * system line marks what needs a look. Never red.
 */
function PaymentMarker({ card, t }: { card: AdminBoardCardDto; t: AdminMessages }) {
  const marker = markerOf(card);
  const look = marker === 'manual_review' || marker === 'refund_owed';
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-small leading-tight',
        look ? 'font-semibold text-foreground' : 'text-muted-foreground',
      )}
      data-marker={marker}
    >
      <span
        aria-hidden
        className={cn(
          'size-[7px] shrink-0 rounded-full',
          marker === 'paid' && 'bg-sage',
          marker === 'checking' && 'bg-stone',
          marker === 'unpaid' && 'shadow-[inset_0_0_0_1.25px_var(--ink-faint)]',
          look && 'shadow-[inset_0_0_0_1.5px_var(--graphite)]',
        )}
      />
      <span className="truncate">{t.orders.board.marker[marker]}</span>
    </span>
  );
}

/**
 * What a card shows (#52): the number and how long it is in this status, the customer, how many
 * items and where it goes, the payment marker and the total. The time is measured from the
 * server's `at`, so a slow clock in the browser never ages an order.
 */
export function CardBody({
  card,
  at,
  t,
  language,
  menu,
}: {
  card: AdminBoardCardDto;
  at: string;
  t: AdminMessages;
  language: Language;
  /** The «Переместить в…» button: it takes the top-right corner beside the time. */
  menu?: React.ReactNode;
}) {
  const o = t.orders;
  const waited = age(secondsIn(card.statusSince, at), t.home);
  const items = fill(plural(language, card.itemCount, ordersMessages[language].orders.items), {
    n: String(card.itemCount),
  });
  return (
    <div className="grid gap-1">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="text-[14px] font-semibold whitespace-nowrap tabular-nums">
          {fill(o.number, { number: String(card.number) })}
        </span>
        <span className="flex min-w-0 items-center gap-0.5">
          <span
            className="truncate text-small whitespace-nowrap text-muted-foreground tabular-nums"
            title={fill(o.board.inStatus, { age: waited })}
          >
            <span className="sr-only">{fill(o.board.inStatus, { age: '' })}</span>
            {waited}
          </span>
          {menu}
        </span>
      </div>
      <p className="truncate text-[13.5px] leading-snug font-medium" title={card.customer.name}>
        {card.customer.name}
      </p>
      <MetaLine
        className="text-small leading-snug text-muted-foreground"
        parts={[
          <span key="n" className="whitespace-nowrap">
            {items}
          </span>,
          <span key="city">{card.city ?? card.region[language]}</span>,
          card.isGift && (
            <span key="gift" className="inline-flex items-center gap-1 whitespace-nowrap">
              <Gift className="size-3.5" strokeWidth={1.5} aria-hidden />
              {o.gift}
            </span>
          ),
        ]}
      />
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <PaymentMarker card={card} t={t} />
        <span className="ml-auto text-[13.5px] font-semibold whitespace-nowrap tabular-nums">
          {boardMoney(card.total, language)}
        </span>
      </div>
    </div>
  );
}

/** A move the menu offers: the status it goes to and whether a dialog will ask for words. */
export type Target = { status: OrderStatus; asks: boolean };

/**
 * «Переместить в…»: the non-drag path (#52). Only the statuses staff may move this order to; a
 * move that needs words ends in «…», as its dialog follows.
 */
function MoveMenu({
  card,
  targets,
  t,
  language,
  onMove,
  disabled,
}: {
  card: AdminBoardCardDto;
  targets: Target[];
  t: AdminMessages;
  language: Language;
  onMove: (to: OrderStatus) => void;
  disabled: boolean;
}) {
  const b = t.orders.board;
  const statuses = ordersMessages[language].orders.status;
  // the card's own drag starts on a press anywhere in it: the menu's press is the menu's
  const keep = (e: MouseEvent | TouchEvent) => e.stopPropagation();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        disabled={disabled}
        aria-label={fill(b.moveFor, { number: String(card.number) })}
        onMouseDown={keep}
        onTouchStart={keep}
        className="relative z-10 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-button text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-field hover:text-foreground active:scale-[0.94] disabled:opacity-40 data-[state=open]:bg-field data-[state=open]:text-foreground after:absolute after:-inset-1.5"
        data-move-menu={card.number}
      >
        <Ellipsis className="size-[18px]" strokeWidth={1.5} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="motion-menu z-[70] min-w-[220px] max-w-[min(320px,calc(100vw-24px))] rounded-card border border-border-strong bg-card p-1.5 text-foreground"
        >
          <Menu.Label className="px-2.5 pt-1.5 pb-1 text-[12.5px] font-medium text-muted-foreground">
            {b.move}
          </Menu.Label>
          {targets.map((target) => (
            <Menu.Item
              key={target.status}
              onSelect={() => onMove(target.status)}
              className="flex min-h-10 cursor-default items-center rounded-button px-2.5 py-2 text-[15px] leading-snug outline-none select-none data-[highlighted]:bg-field"
              data-move-to={target.status}
            >
              {statuses[target.status]}
              {target.asks ? '…' : ''}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * One order on the board: a white card that opens the order page, carried by a mouse drag, a
 * long press, or Space on its link (Enter still opens it). While carried its place stays as an
 * empty slot; while its dialog asks or its move is saved it waits in the new column, faded.
 */
export function BoardCard({
  card,
  at,
  t,
  language,
  targets,
  onMove,
  waiting,
  arrived,
  locked,
}: {
  card: AdminBoardCardDto;
  at: string;
  t: AdminMessages;
  language: Language;
  targets: Target[];
  onMove: (to: OrderStatus) => void;
  /** Its move is not settled yet (a dialog asks, or the request runs). */
  waiting: boolean;
  /** It came into this column with the last fresh board: it settles in once. */
  arrived: boolean;
  /** Another move runs: nothing else is picked up meanwhile. */
  locked: boolean;
}) {
  const o = t.orders;
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `order:${card.number}`,
    data: { card },
    disabled: locked || waiting || targets.length === 0,
  });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      // a long press is a pick-up here, never the browser's link menu
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'relative touch-manipulation rounded-card bg-card px-3 pt-2 pb-3 select-none [-webkit-touch-callout:none] hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)]',
        'transition-[opacity,box-shadow] duration-150 ease-out',
        // the place it was picked up from: an empty slot of the same size
        isDragging &&
          'bg-transparent shadow-[inset_0_0_0_1.5px_var(--hairline-strong)] [&>div]:invisible',
        waiting && 'opacity-55',
        arrived && 'motion-card-arrive',
      )}
      aria-busy={waiting || undefined}
      data-order={card.number}
      data-status={card.status}
    >
      <CardBody
        card={card}
        at={at}
        t={t}
        language={language}
        menu={
          targets.length > 0 ? (
            <MoveMenu
              card={card}
              targets={targets}
              t={t}
              language={language}
              onMove={onMove}
              disabled={locked || waiting}
            />
          ) : undefined
        }
      />
      <Link
        ref={setActivatorNodeRef}
        href={`/orders/${card.number}`}
        draggable={false}
        aria-describedby={attributes['aria-describedby']}
        className="absolute inset-0 rounded-card [-webkit-touch-callout:none] focus-visible:outline-offset-0"
      >
        <span className="sr-only">
          {fill(o.number, { number: String(card.number) })}, {card.customer.name}
        </span>
      </Link>
    </li>
  );
}

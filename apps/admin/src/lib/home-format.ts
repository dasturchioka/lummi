import type { HomeNow, HomeQueue, TashkentMoment } from '@lummi/contracts';
import { addDays, formatLocalDate, parseLocalDate } from '@lummi/contracts';
import { formatCalendarDate, type Language } from '@lummi/i18n';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

/*
 * The admin Home's words for numbers and moments (#48). The server sends ages in seconds and
 * moments on the Tashkent wall clock with its own day, so «сегодня» and «вчера» never depend on
 * the browser's clock or time zone.
 */

type HomeCopy = AdminMessages['home'];

const NB = ' ';
const MINUS = '−';

/** How long something waits: «27 с», «12 мин», «3 ч 5 мин», «2 дн.», rounded down. */
export function age(seconds: number, copy: HomeCopy): string {
  const a = copy.age;
  if (seconds < 60) return fill(a.seconds, { n: String(seconds) });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return fill(a.minutes, { n: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes % 60;
    return m === 0
      ? fill(a.hours, { n: String(hours) })
      : fill(a.hoursMinutes, { h: String(hours), m: String(m) });
  }
  return fill(a.days, { n: String(Math.floor(hours / 24)) });
}

/** A past moment in one of the copy's three forms: today, yesterday, or an earlier date. */
export function moment(
  at: TashkentMoment,
  today: string,
  forms: { today: string; yesterday: string; earlier: string },
  language: Language,
): string {
  const yesterday = formatLocalDate(addDays(parseLocalDate(today), -1));
  if (at.day === today) return fill(forms.today, { time: at.time });
  if (at.day === yesterday) return fill(forms.yesterday, { time: at.time });
  return fill(forms.earlier, { date: formatCalendarDate(at.day, language), time: at.time });
}

/** `+18 %`, `−10 %`, `0 %` against `base`; null when there is nothing to compare with. */
export function change(value: number | null, base: number | null): string | null {
  if (value === null || base === null || base <= 0) return null;
  const pct = Math.round(((value - base) / base) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? MINUS : ''}${Math.abs(pct)}${NB}%`;
}

/** `+2`, `−2`, `0`: orders against the same time a week ago. */
export function countChange(value: number, base: number): string {
  const d = value - base;
  return `${d > 0 ? '+' : d < 0 ? MINUS : ''}${Math.abs(d)}`;
}

/** How full the Sage Thread is: the receipt's wait against the alert setting, at most full. */
export function threadShare(waitedSeconds: number, alertSeconds: number): number {
  return Math.min(1, Math.max(0, waitedSeconds / alertSeconds));
}

/**
 * Which item the Now block holds: the same order, credit, stock row or state keeps its key while
 * its wait grows, so the block animates only when its item changes.
 */
export function nowKey(now: HomeNow): string {
  switch (now.kind) {
    case 'receipt':
    case 'accept':
    case 'assemble':
    case 'bts':
    case 'refund':
    case 'review':
      return `${now.kind}:${now.number}`;
    case 'credit':
      return `credit:${now.id}`;
    case 'stock':
      return now.item.kind === 'discovery'
        ? `stock:discovery:${now.item.key}`
        : `stock:${now.item.kind}:${now.item.name ?? ''}`;
    default:
      return now.kind;
  }
}

/** Each queue row's list, filtered to exactly its items (#48); orders as the list, not the board (#52). */
export const QUEUE_HREF: Record<HomeQueue, string> = {
  receipts: '/orders?view=list&payment=manual_review',
  accept: '/orders?view=list&status=payment_confirmed',
  assemble: '/orders?view=list&status=accepted',
  bts: '/orders?view=list&status=assembling',
  credits: '/credits?linked=unlinked',
  refunds: '/orders?view=list&payment=refund_owed',
  stock: '/stock?filter=low&visibility=visible',
  reviews: '/reviews?state=waiting',
};

/** The weekday of a Tashkent day `YYYY-MM-DD`, Sunday first (the copy's `weekdays` order). */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** «нет 1 · мало 2»: each half of the stock count only when it is above zero. */
export function stockHalves(stock: { out: number; low: number }): ('out' | 'low')[] {
  return (['out', 'low'] as const).filter((k) => stock[k] > 0);
}

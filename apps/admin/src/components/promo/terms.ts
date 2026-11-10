import type { AdminPromoCode } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { num } from '@/components/broadcasts/format';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

type Terms = Pick<
  AdminPromoCode,
  | 'kind'
  | 'percent'
  | 'amount'
  | 'maxDiscount'
  | 'expiresOn'
  | 'minOrderTotal'
  | 'perCustomerLimit'
  | 'newCustomersOnly'
  | 'appliesToMarkedDown'
>;

/** «−10 %, не больше 30 000 сум» or «−50 000 сум»: what the code takes off the items. */
export function discountOf(p: Terms, t: AdminMessages, language: Language): string {
  const m = t.promo;
  if (p.kind === 'fixed') return `−${formatMoney(p.amount ?? 0, language)}`;
  const off = fill(m.percentOff, { n: String(p.percent ?? 0) });
  return p.maxDiscount === null
    ? off
    : `${off}, ${fill(m.capped, { amount: formatMoney(p.maxDiscount, language) })}`;
}

/** `2026-11-30` as the panel writes days: `30.11.2026` (a Tashkent calendar day, no time zone). */
export const dayOf = (iso: string) => iso.split('-').reverse().join('.');

/** The conditions after the discount, each a short part of a meta line. */
export function conditionsOf(p: Terms, t: AdminMessages, language: Language): string[] {
  const m = t.promo;
  return [
    p.expiresOn ? fill(m.until, { date: dayOf(p.expiresOn) }) : null,
    p.minOrderTotal ? fill(m.minimum, { amount: formatMoney(p.minOrderTotal, language) }) : null,
    p.perCustomerLimit ? fill(m.perCustomer, { n: num(p.perCustomerLimit) }) : null,
    p.newCustomersOnly ? m.newOnly : null,
    p.appliesToMarkedDown ? m.markedDown : null,
  ].filter((x): x is string => x !== null);
}

/** «12 из 100», or «12» for a code without a total limit. */
export const usesOf = (p: Pick<AdminPromoCode, 'uses' | 'totalLimit'>, t: AdminMessages) =>
  p.totalLimit === null
    ? num(p.uses)
    : fill(t.promo.uses, { used: num(p.uses), limit: num(p.totalLimit) });

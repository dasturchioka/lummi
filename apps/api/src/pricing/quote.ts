import type {
  Discount,
  PromoCodeInvalid,
  Quote,
  QuoteLine,
  SettingValue,
  ThresholdBase,
  UpgradeRightSource,
} from '@lummi/contracts';

/** A volume's or set's current price: regular, plus an optional markdown (ADR 0008). */
export interface Price {
  regular: number;
  sale: { price: number; endsAt: Date | null } | null;
}

/** One cart line as priced now. A builder set and the Discovery set are both `set` items. */
export interface QuoteLineInput {
  key: string;
  item: { kind: 'volume'; fragranceId: number; volumeMl: number } | { kind: 'set' };
  qty: number;
  price: Price;
  soldOut: boolean;
}

/** A discount source the customer holds (an active one; the caller loads only those). */
export type Entitlement =
  | {
      type: 'upgrade_right';
      id: number;
      source: UpgradeRightSource;
      percent: number;
      /** The fragrances whose full-size bottles it covers. */
      fragranceIds: number[];
      expiresAt: Date;
    }
  | { type: 'birthday_coupon'; id: number; percent: number; maxAmount: number; expiresAt: Date };

/** An entered promo code that passed the checks needing the DB (exists, active, limits, new customer). */
export type PromoCode = {
  code: string;
  /** Checked against items before discount, without delivery. */
  minOrderTotal: number | null;
  appliesToMarkedDown: boolean;
} & (
  | { kind: 'percent'; percent: number; maxDiscount: number | null }
  | { kind: 'fixed'; amount: number }
);

/** The discount the customer switched to in the cart (ADR 0002). */
export type DiscountChoice =
  { type: 'upgrade_right' | 'birthday_coupon'; id: number } | { type: 'promo_code' };

export interface PricingSettings {
  freeDeliveryThreshold: SettingValue<'pricing.freeDeliveryThreshold'>;
  thresholdBase: SettingValue<'pricing.thresholdBase'>;
  discountsApplyToMarkedDown: SettingValue<'pricing.discountsApplyToMarkedDown'>;
  fullSizeVolumesMl: SettingValue<'pricing.fullSizeVolumesMl'>;
}

export interface QuoteInput {
  lines: QuoteLineInput[];
  entitlements: Entitlement[];
  promoCode: PromoCode | null;
  choice: DiscountChoice | null;
  /** The region's delivery tariff before the free-delivery threshold. */
  deliveryTariff: number;
  settings: PricingSettings;
  /** Decides whether a markdown is still active. */
  now: Date;
}

interface PricedLine extends QuoteLine {
  item: QuoteLineInput['item'];
}

/** A discount source that would discount this cart, before the choice between them. */
interface Candidate {
  discount: Discount;
  base: ThresholdBase;
  expiresAt: Date | null;
}

interface Settlement {
  thresholdBaseAmount: number;
  deliveryFee: number;
  total: number;
}

/**
 * The only place money is computed (ADR 0001): pure, no DB, no clock. Lines, at most one
 * Discount, the free-delivery threshold and the total, from the inputs alone.
 */
export function quote(input: QuoteInput): Quote {
  assertWholeInputs(input);
  const priced = input.lines.map((line) => priceLine(line, input.now));
  const billable = priced.filter((l) => !l.soldOut);
  const itemsSubtotal = sum(billable.map((l) => l.lineTotal));

  const fromEntitlements = input.entitlements.flatMap((e) => {
    const c = entitlementCandidate(e, billable, input.settings);
    return c ? [c] : [];
  });
  const promo = input.promoCode
    ? promoOutcome(input.promoCode, billable, itemsSubtotal, input.settings)
    : null;
  const candidates = promo?.candidate ? [...fromEntitlements, promo.candidate] : fromEntitlements;

  // ADR 0002: the customer's switch while it still applies; else an entered valid code; else the
  // entitlement giving the lowest total.
  const { choice } = input;
  const chosen = choice ? (candidates.find((c) => matchesChoice(c, choice)) ?? null) : null;
  const applied =
    chosen ?? promo?.candidate ?? automaticChoice(fromEntitlements, itemsSubtotal, input);
  const settled = settle(itemsSubtotal, applied, input);

  const alternatives = candidates
    .filter((c) => c !== applied)
    .map((c) => {
      const s = settle(itemsSubtotal, c, input);
      return {
        discount: c.discount,
        deliveryFee: s.deliveryFee,
        total: s.total,
        cheaperBy: Math.max(0, settled.total - s.total),
      };
    })
    .sort((a, b) => a.total - b.total);

  return {
    lines: priced.map(({ item: _item, ...line }) => line),
    itemsSubtotal,
    discount: applied?.discount ?? null,
    thresholdBase: applied?.base ?? 'before',
    thresholdBaseAmount: settled.thresholdBaseAmount,
    freeDeliveryThreshold: input.settings.freeDeliveryThreshold,
    amountToFreeDelivery: Math.max(
      0,
      input.settings.freeDeliveryThreshold - settled.thresholdBaseAmount,
    ),
    deliveryFee: settled.deliveryFee,
    total: settled.total,
    alternatives,
    promoCode: input.promoCode
      ? { code: input.promoCode.code, invalid: promo?.invalid ?? null }
      : null,
    staleChoice: choice !== null && chosen === null,
  };
}

function matchesChoice(c: Candidate, choice: DiscountChoice): boolean {
  const d = c.discount;
  if (choice.type === 'promo_code') return d.type === 'promo_code';
  return d.type === choice.type && d.id === choice.id;
}

/**
 * Promo code (ADR 0007): % of eligible items capped by the code's max, or min(fixed, eligible).
 * Its minimum is checked on items before discount, without delivery; a code that can't discount
 * this cart says why instead of blocking the order.
 */
function promoOutcome(
  p: PromoCode,
  billable: PricedLine[],
  items: number,
  settings: PricingSettings,
): { candidate: Candidate | null; invalid: PromoCodeInvalid | null } {
  if (p.minOrderTotal !== null && items < p.minOrderTotal) {
    return {
      candidate: null,
      invalid: { reason: 'below_minimum', minOrderTotal: p.minOrderTotal },
    };
  }
  const eligible = eligibleItems(billable, p.appliesToMarkedDown);
  const amount =
    p.kind === 'percent'
      ? Math.min(percentOf(eligible, p.percent), p.maxDiscount ?? eligible)
      : Math.min(p.amount, eligible);
  if (amount === 0) return { candidate: null, invalid: { reason: 'no_eligible_items' } };
  return {
    candidate: {
      discount: { type: 'promo_code', code: p.code, amount },
      base: settings.thresholdBase.promoCode,
      expiresAt: null,
    },
    invalid: null,
  };
}

function priceLine(line: QuoteLineInput, now: Date): PricedLine {
  const sale = activeMarkdown(line.price, now);
  const unitPrice = sale ?? line.price.regular;
  return {
    key: line.key,
    item: line.item,
    qty: line.qty,
    unitPrice,
    regularUnitPrice: line.price.regular,
    markedDown: sale !== null,
    lineTotal: unitPrice * line.qty,
    soldOut: line.soldOut,
  };
}

/** A markdown is active while its price is below the regular one and its end instant hasn't come. */
function activeMarkdown(price: Price, now: Date): number | null {
  const sale = price.sale;
  if (!sale || sale.price >= price.regular) return null;
  if (sale.endsAt !== null && now.getTime() >= sale.endsAt.getTime()) return null;
  return sale.price;
}

function entitlementCandidate(
  e: Entitlement,
  billable: PricedLine[],
  settings: PricingSettings,
): Candidate | null {
  return e.type === 'upgrade_right'
    ? upgradeRightCandidate(e, billable, settings)
    : birthdayCandidate(e, billable, settings);
}

/** Birthday coupon (ADR 0007): items × %, capped; sets count, marked-down items only if allowed. */
function birthdayCandidate(
  e: Extract<Entitlement, { type: 'birthday_coupon' }>,
  billable: PricedLine[],
  settings: PricingSettings,
): Candidate | null {
  const eligible = eligibleItems(billable, settings.discountsApplyToMarkedDown.birthdayCoupon);
  const amount = Math.min(percentOf(eligible, e.percent), e.maxAmount);
  if (amount === 0) return null;
  return {
    discount: { type: 'birthday_coupon', id: e.id, amount },
    base: settings.thresholdBase.birthdayCoupon,
    expiresAt: e.expiresAt,
  };
}

/** Items a discount may reduce: every billable line, marked-down ones only when allowed (ADR 0008). */
function eligibleItems(billable: PricedLine[], appliesToMarkedDown: boolean): number {
  return sum(billable.filter((l) => appliesToMarkedDown || !l.markedDown).map((l) => l.lineTotal));
}

/**
 * Upgrade right (ADR 0007): % of the single most expensive covered Full size unit. Sets are never
 * full size (ADR 0009); marked-down bottles only when the setting allows it (ADR 0008).
 */
function upgradeRightCandidate(
  e: Extract<Entitlement, { type: 'upgrade_right' }>,
  billable: PricedLine[],
  settings: PricingSettings,
): Candidate | null {
  let target: PricedLine | null = null;
  for (const l of billable) {
    if (l.item.kind !== 'volume') continue;
    if (!e.fragranceIds.includes(l.item.fragranceId)) continue;
    if (!settings.fullSizeVolumesMl.includes(l.item.volumeMl)) continue;
    if (l.markedDown && !settings.discountsApplyToMarkedDown.upgradeRight) continue;
    if (!target || l.unitPrice > target.unitPrice) target = l;
  }
  if (!target) return null;
  const amount = percentOf(target.unitPrice, e.percent);
  if (amount === 0) return null;
  return {
    discount: { type: 'upgrade_right', id: e.id, source: e.source, amount, lineKey: target.key },
    base:
      e.source === 'set'
        ? settings.thresholdBase.upgradeRightSet
        : settings.thresholdBase.upgradeRightSingle10ml,
    expiresAt: e.expiresAt,
  };
}

/**
 * ADR 0002: the entitlement giving the lowest total including delivery; equal totals go to the
 * one expiring first. An entitlement that doesn't lower the total below "no discount" (its
 * discount brings delivery back) stays unused, so the customer keeps it.
 */
function automaticChoice(
  entitlements: Candidate[],
  items: number,
  input: QuoteInput,
): Candidate | null {
  let best: Candidate | null = null;
  let bestTotal = settle(items, null, input).total;
  for (const c of entitlements) {
    const total = settle(items, c, input).total;
    const sooner = best !== null && total === bestTotal && expiresBefore(c, best);
    if (total < bestTotal || sooner) {
      best = c;
      bestTotal = total;
    }
  }
  return best;
}

function expiresBefore(a: Candidate, b: Candidate): boolean {
  return (a.expiresAt?.getTime() ?? Infinity) < (b.expiresAt?.getTime() ?? Infinity);
}

/** Applies a discount (or none) to the items: the threshold base, the delivery fee and the total. */
function settle(items: number, applied: Candidate | null, input: QuoteInput): Settlement {
  const amount = applied?.discount.amount ?? 0;
  const thresholdBaseAmount = applied?.base === 'after' ? items - amount : items;
  // Nothing to deliver costs nothing; otherwise free once the base reaches the threshold.
  const free = items === 0 || thresholdBaseAmount >= input.settings.freeDeliveryThreshold;
  const deliveryFee = free ? 0 : input.deliveryTariff;
  return { thresholdBaseAmount, deliveryFee, total: items - amount + deliveryFee };
}

/**
 * `amount × percent / 100`, rounded down to a whole so'm. The one rounding point for every
 * discount (ADR 0007), in exact integer arithmetic.
 */
function percentOf(amount: number, percent: number): number {
  const scaled = amount * percent;
  return (scaled - (scaled % 100)) / 100;
}

/** Integer so'm only (ADR 0016): a float or negative amount never enters the money path. */
function assertWholeInputs(input: QuoteInput): void {
  for (const l of input.lines) {
    som(`line ${l.key} price`, l.price.regular);
    if (l.price.sale) som(`line ${l.key} sale price`, l.price.sale.price);
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) {
      throw new RangeError(`line ${l.key} qty must be a whole number from 1: ${l.qty}`);
    }
  }
  som('delivery tariff', input.deliveryTariff);
  som('free-delivery threshold', input.settings.freeDeliveryThreshold);
  for (const e of input.entitlements) {
    percent(`${e.type} ${e.id} percent`, e.percent);
    if (e.type === 'birthday_coupon') som(`birthday coupon ${e.id} max`, e.maxAmount);
  }
  const p = input.promoCode;
  if (p) {
    if (p.minOrderTotal !== null) som(`promo ${p.code} minimum`, p.minOrderTotal);
    if (p.kind === 'fixed') som(`promo ${p.code} amount`, p.amount);
    else {
      percent(`promo ${p.code} percent`, p.percent);
      if (p.maxDiscount !== null) som(`promo ${p.code} max discount`, p.maxDiscount);
    }
  }
}

function som(what: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be whole non-negative so'm: ${value}`);
  }
}

function percent(what: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError(`${what} must be a whole number from 0 to 100: ${value}`);
  }
}

function sum(amounts: number[]): number {
  return amounts.reduce((a, b) => a + b, 0);
}

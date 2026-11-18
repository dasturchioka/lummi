import type {
  Discount,
  PromoGiftItem,
  PromoCodeInvalid,
  PromoCodeRefusal,
  Quote,
  QuoteLine,
  SettingValue,
  ThresholdBase,
  UpgradeRightSource,
} from '@lummi/contracts';

/** A volume's or set's current price: regular, plus an optional Markdown (ADR 0008). */
export interface Price {
  regular: number;
  markdown: { price: number; endsAt: Date | null } | null;
}

/** A volume's stored price columns as `quote()` takes them: the one mapping (ADR 0008). */
export function volumePrice(v: {
  price: number;
  salePrice: number | null;
  saleEndsAt: Date | null;
}): Price {
  return {
    regular: v.price,
    markdown: v.salePrice === null ? null : { price: v.salePrice, endsAt: v.saleEndsAt },
  };
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

/**
 * A gift code's free item (ADR 0039) as the caller found it: its regular price (the value reports
 * count), and whether none is left after the cart's own lines took theirs.
 */
export interface PricedPromoGift {
  item: PromoGiftItem;
  regular: number;
  soldOut: boolean;
}

/** An entered promo code that passed the checks needing the DB (exists, active, limits, new customer). */
export type PromoCode = {
  code: string;
  /** Checked against items before discount, without delivery (a gift excluded). */
  minOrderTotal: number | null;
  appliesToMarkedDown: boolean;
} & (
  | { kind: 'percent'; percent: number; maxDiscount: number | null }
  | { kind: 'fixed'; amount: number }
  | { kind: 'gift'; promoGift: PricedPromoGift }
);

/** An entered code the shop refused before pricing (unknown, expired, used up, ...): shown with its reason. */
export interface RefusedPromoCode {
  code: string;
  refused: PromoCodeRefusal;
}

/**
 * The discount the customer switched to in the cart (ADR 0002): an entitlement, the entered code,
 * or `none` («Не применять», #39), which applies no discount so the entitlements keep for later.
 */
export type DiscountChoice =
  | { type: 'upgrade_right' | 'birthday_coupon'; id: number }
  | { type: 'promo_code' }
  | { type: 'none' };

export interface PricingSettings {
  freeDeliveryThreshold: SettingValue<'pricing.freeDeliveryThreshold'>;
  thresholdBase: SettingValue<'pricing.thresholdBase'>;
  discountsApplyToMarkedDown: SettingValue<'pricing.discountsApplyToMarkedDown'>;
  fullSizeVolumesMl: SettingValue<'pricing.fullSizeVolumesMl'>;
}

export interface QuoteInput {
  lines: QuoteLineInput[];
  entitlements: Entitlement[];
  /** The entered code: priced when it passed the DB checks, else echoed with why it was refused. */
  promoCode: PromoCode | RefusedPromoCode | null;
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

/** A discount one source would give this cart, before the choice between sources. */
interface DiscountOption {
  discount: Discount;
  base: ThresholdBase;
  expiresAt: Date | null;
  /**
   * How the amount grows as discountable items are added: `min(⌊(eligible + N) × percent / 100⌋, cap)`.
   * Null when it stays put (an upgrade right discounts one unit). Only the nudge uses it.
   */
  growth: { eligibleSubtotal: number; percent: number; cap: number | null } | null;
}

interface Delivery {
  tariff: number;
  threshold: number;
}

interface Totals {
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
  const { settings } = input;
  const delivery: Delivery = {
    tariff: input.deliveryTariff,
    threshold: settings.freeDeliveryThreshold,
  };
  const priced = input.lines.map((line) => priceLine(line, input.now));
  const billable = priced.filter((l) => !l.soldOut);
  const itemsSubtotal = sum(billable.map((l) => l.lineTotal));

  const fromEntitlements = input.entitlements.flatMap((e) => {
    const option = entitlementOption(e, billable, settings);
    return option ? [option] : [];
  });
  const entered = input.promoCode;
  const promo = !entered
    ? null
    : 'refused' in entered
      ? { option: null, invalid: { reason: entered.refused } }
      : promoOutcome(entered, billable, itemsSubtotal, settings);
  const options = promo?.option ? [...fromEntitlements, promo.option] : fromEntitlements;

  // ADR 0002: the customer's switch while it still applies («Не применять» always does); else an
  // entered valid code; else the entitlement giving the lowest total.
  const { choice } = input;
  const declined = choice?.type === 'none';
  const chosen =
    choice && !declined ? (options.find((o) => matchesChoice(o, choice)) ?? null) : null;
  const applied = declined
    ? null
    : (chosen ?? promo?.option ?? automaticChoice(fromEntitlements, itemsSubtotal, delivery));
  const totals = totalsWith(itemsSubtotal, applied, delivery);
  const bare = totalsWith(itemsSubtotal, null, delivery);

  const alternatives = options
    .filter((o) => o !== applied)
    .map((o) => {
      const t = totalsWith(itemsSubtotal, o, delivery);
      return {
        option: o,
        discount: o.discount,
        deliveryFee: t.deliveryFee,
        total: t.total,
        cheaperBy: Math.max(0, totals.total - t.total),
      };
    })
    .sort((a, b) => a.total - b.total || tieBreak(a.option, b.option));

  return {
    lines: priced.map(({ item: _item, ...line }) => line),
    itemsSubtotal,
    discount: applied?.discount ?? null,
    thresholdBase: applied?.base ?? 'before',
    thresholdBaseAmount: totals.thresholdBaseAmount,
    freeDeliveryThreshold: delivery.threshold,
    amountToFreeDelivery: amountToFreeDelivery(itemsSubtotal, applied, delivery.threshold),
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    alternatives: alternatives.map(({ option: _option, ...alternative }) => alternative),
    withoutDiscount: { deliveryFee: bare.deliveryFee, total: bare.total },
    promoCode: input.promoCode
      ? { code: input.promoCode.code, invalid: promo?.invalid ?? null }
      : null,
    staleChoice: choice !== null && !declined && chosen === null,
  };
}

function matchesChoice(
  o: DiscountOption,
  choice: Exclude<DiscountChoice, { type: 'none' }>,
): boolean {
  const d = o.discount;
  if (choice.type === 'promo_code') return d.type === 'promo_code';
  return d.type === choice.type && d.id === choice.id;
}

function priceLine(line: QuoteLineInput, now: Date): PricedLine {
  const markdown = activeMarkdown(line.price, now);
  const unitPrice = markdown ?? line.price.regular;
  return {
    key: line.key,
    item: line.item,
    qty: line.qty,
    unitPrice,
    regularUnitPrice: line.price.regular,
    markedDown: markdown !== null,
    lineTotal: unitPrice * line.qty,
    soldOut: line.soldOut,
  };
}

/**
 * A markdown is active while its price is below the regular one, up to and including its end
 * instant (admin stores «до <дата>» as 23:59:59 Asia/Tashkent that day, like promo expiry).
 */
export function activeMarkdown(price: Price, now: Date): number | null {
  const markdown = price.markdown;
  if (!markdown || markdown.price >= price.regular) return null;
  if (markdown.endsAt !== null && now.getTime() > markdown.endsAt.getTime()) return null;
  return markdown.price;
}

/** ADR 0008: no discount reaches a marked-down line unless its source's flag allows it. */
function discountApplies(line: PricedLine, appliesToMarkedDown: boolean): boolean {
  return appliesToMarkedDown || !line.markedDown;
}

/** The items a discount may reduce: every billable line it applies to. */
function eligibleSubtotal(billable: PricedLine[], appliesToMarkedDown: boolean): number {
  return sum(
    billable.filter((l) => discountApplies(l, appliesToMarkedDown)).map((l) => l.lineTotal),
  );
}

function entitlementOption(
  e: Entitlement,
  billable: PricedLine[],
  settings: PricingSettings,
): DiscountOption | null {
  return e.type === 'upgrade_right'
    ? upgradeRightOption(e, billable, settings)
    : birthdayOption(e, billable, settings);
}

/**
 * Upgrade right (ADR 0007): % of the single most expensive covered Full size unit. Sets are never
 * full size (ADR 0009); marked-down bottles only when the setting allows it (ADR 0008).
 */
function upgradeRightOption(
  e: Extract<Entitlement, { type: 'upgrade_right' }>,
  billable: PricedLine[],
  settings: PricingSettings,
): DiscountOption | null {
  let target: PricedLine | null = null;
  for (const l of billable) {
    if (l.item.kind !== 'volume') continue;
    if (!e.fragranceIds.includes(l.item.fragranceId)) continue;
    if (!settings.fullSizeVolumesMl.includes(l.item.volumeMl)) continue;
    if (!discountApplies(l, settings.discountsApplyToMarkedDown.upgradeRight)) continue;
    if (!target || l.unitPrice > target.unitPrice) target = l;
  }
  if (!target) return null;
  const amount = percentOf(target.unitPrice, e.percent);
  if (amount === 0) return null;
  return {
    discount: {
      type: 'upgrade_right',
      id: e.id,
      source: e.source,
      percent: e.percent,
      amount,
      lineKey: target.key,
    },
    base: settings.thresholdBase.upgradeRight[e.source],
    expiresAt: e.expiresAt,
    growth: null,
  };
}

/** Birthday coupon (ADR 0007): items × %, capped; sets count, marked-down items only if allowed. */
function birthdayOption(
  e: Extract<Entitlement, { type: 'birthday_coupon' }>,
  billable: PricedLine[],
  settings: PricingSettings,
): DiscountOption | null {
  const eligible = eligibleSubtotal(billable, settings.discountsApplyToMarkedDown.birthdayCoupon);
  const amount = Math.min(percentOf(eligible, e.percent), e.maxAmount);
  if (amount === 0) return null;
  return {
    discount: { type: 'birthday_coupon', id: e.id, amount },
    base: settings.thresholdBase.birthdayCoupon,
    expiresAt: e.expiresAt,
    growth: { eligibleSubtotal: eligible, percent: e.percent, cap: e.maxAmount },
  };
}

/**
 * Promo code (ADR 0007): % of eligible items capped by the code's max, or min(fixed, eligible).
 * Its minimum is checked on items before discount, without delivery; a code that can't discount
 * this cart says why instead of blocking the order. A gift code is `promoGiftOutcome`'s.
 */
function promoOutcome(
  p: PromoCode,
  billable: PricedLine[],
  itemsSubtotal: number,
  settings: PricingSettings,
): { option: DiscountOption | null; invalid: PromoCodeInvalid | null } {
  if (p.kind === 'gift') return promoGiftOutcome(p, itemsSubtotal, settings);
  if (p.minOrderTotal !== null && itemsSubtotal < p.minOrderTotal) {
    return { option: null, invalid: { reason: 'below_minimum', minOrderTotal: p.minOrderTotal } };
  }
  const eligible = eligibleSubtotal(billable, p.appliesToMarkedDown);
  const amount =
    p.kind === 'percent'
      ? Math.min(percentOf(eligible, p.percent), p.maxDiscount ?? eligible)
      : Math.min(p.amount, eligible);
  if (amount === 0) return { option: null, invalid: { reason: 'no_eligible_items' } };
  return {
    option: {
      discount: { type: 'promo_code', code: p.code, amount },
      base: settings.thresholdBase.promoCode,
      expiresAt: null,
      // A fixed code is 100% of the eligible items, capped at its amount.
      growth:
        p.kind === 'percent'
          ? { eligibleSubtotal: eligible, percent: p.percent, cap: p.maxDiscount }
          : { eligibleSubtotal: eligible, percent: 100, cap: p.amount },
    },
    invalid: null,
  };
}

/**
 * A gift code (ADR 0039): its item comes free, so nothing comes off the paid items (amount 0) and
 * the threshold base is the paid items whatever the code's base setting. Refused when none of the
 * gift is left («Подарок закончился», said first: adding items won't bring it back), when the paid
 * items are below the minimum, or when nothing is paid for («gift_needs_items»). Marked-down items change nothing.
 */
function promoGiftOutcome(
  p: Extract<PromoCode, { kind: 'gift' }>,
  itemsSubtotal: number,
  settings: PricingSettings,
): { option: DiscountOption | null; invalid: PromoCodeInvalid | null } {
  if (p.promoGift.soldOut) return { option: null, invalid: { reason: 'gift_sold_out' } };
  if (p.minOrderTotal !== null && itemsSubtotal < p.minOrderTotal) {
    return { option: null, invalid: { reason: 'below_minimum', minOrderTotal: p.minOrderTotal } };
  }
  // the gift comes with an order: with nothing paid for there is none (every line sold out)
  if (itemsSubtotal === 0) return { option: null, invalid: { reason: 'gift_needs_items' } };
  return {
    option: {
      discount: {
        type: 'promo_code',
        code: p.code,
        amount: 0,
        promoGift: { item: p.promoGift.item, value: p.promoGift.regular },
      },
      base: settings.thresholdBase.promoCode,
      expiresAt: null,
      growth: null,
    },
    invalid: null,
  };
}

/**
 * ADR 0002: the entitlement giving the lowest total including delivery, ties broken by
 * `tieBreak`. An entitlement that doesn't lower the total below "no discount" (its discount
 * brings delivery back) stays unused, so the customer keeps it.
 */
function automaticChoice(
  entitlements: DiscountOption[],
  itemsSubtotal: number,
  delivery: Delivery,
): DiscountOption | null {
  const [best] = entitlements
    .map((option) => ({ option, total: totalsWith(itemsSubtotal, option, delivery).total }))
    .sort((a, b) => a.total - b.total || tieBreak(a.option, b.option));
  const withoutDiscount = totalsWith(itemsSubtotal, null, delivery).total;
  return best && best.total < withoutDiscount ? best.option : null;
}

/** Equal totals: the soonest expiry, then the lowest id, then the type; never the input order. */
function tieBreak(a: DiscountOption, b: DiscountOption): number {
  const key = (o: DiscountOption) => ({
    expiry: o.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
    id: o.discount.type === 'promo_code' ? 0 : o.discount.id,
  });
  const ka = key(a);
  const kb = key(b);
  return ka.expiry - kb.expiry || ka.id - kb.id || a.discount.type.localeCompare(b.discount.type);
}

/** The threshold base, delivery fee and total once a discount (or none) is applied to the items. */
function totalsWith(
  itemsSubtotal: number,
  applied: DiscountOption | null,
  delivery: Delivery,
): Totals {
  const amount = applied?.discount.amount ?? 0;
  const thresholdBaseAmount = applied?.base === 'after' ? itemsSubtotal - amount : itemsSubtotal;
  // Nothing to deliver costs nothing; otherwise free once the base reaches the threshold.
  const free = itemsSubtotal === 0 || thresholdBaseAmount >= delivery.threshold;
  const deliveryFee = free ? 0 : delivery.tariff;
  return { thresholdBaseAmount, deliveryFee, total: itemsSubtotal - amount + deliveryFee };
}

/**
 * The «add N so'm for free delivery» nudge (spec Changes 2026-11-06, 2026-11-07): the smallest
 * whole N for which items + N bring the applied discount's base to the threshold. Under an
 * "after" base a growing discount is counted, as if everything added were discountable, so
 * adding N of anything reaches the threshold.
 */
function amountToFreeDelivery(
  itemsSubtotal: number,
  applied: DiscountOption | null,
  threshold: number,
): number {
  if (!applied || applied.base === 'before') return Math.max(0, threshold - itemsSubtotal);
  const baseNow = itemsSubtotal - applied.discount.amount;
  const g = applied.growth;
  if (!g) return Math.max(0, threshold - baseNow);
  // The base never shrinks as N grows, so the answer is the earlier of two moments:
  // once the cap binds the discount is fixed (items + N − cap ≥ threshold) ...
  const atCap = g.cap === null ? Infinity : Math.max(0, threshold - itemsSubtotal + g.cap);
  // ... and before that, with x = eligible + N: items − eligible + ⌈x(100 − p)/100⌉ ≥ threshold,
  // i.e. x(100 − p) > 100(r − 1) where r = threshold − items + eligible.
  const r = threshold - itemsSubtotal + g.eligibleSubtotal;
  let belowCap = Infinity;
  if (r <= 0) belowCap = 0;
  else if (g.percent < 100) {
    const x = floorDiv(100 * (r - 1), 100 - g.percent) + 1;
    belowCap = Math.max(0, x - g.eligibleSubtotal);
  }
  const n = Math.min(atCap, belowCap);
  // An uncapped 100% code never lets discountable items lift the base; only other items would.
  return Number.isFinite(n) ? n : Math.max(0, threshold - baseNow);
}

/**
 * `amount × percent / 100`, rounded down to a whole so'm. The one rounding point for every
 * discount (ADR 0007).
 */
function percentOf(amount: number, percent: number): number {
  return floorDiv(amount * percent, 100);
}

/** Exact integer division rounding down, for non-negative safe integers. */
function floorDiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** Integer so'm only (ADR 0016): a float or negative amount never enters the money path. */
function assertWholeInputs(input: QuoteInput): void {
  for (const l of input.lines) {
    assertSom(`line ${l.key} price`, l.price.regular);
    if (l.price.markdown) assertSom(`line ${l.key} markdown price`, l.price.markdown.price);
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) {
      throw new RangeError(`line ${l.key} qty must be a whole number from 1: ${l.qty}`);
    }
  }
  assertSom('delivery tariff', input.deliveryTariff);
  assertSom('free-delivery threshold', input.settings.freeDeliveryThreshold);
  for (const e of input.entitlements) {
    assertPercent(`${e.type} ${e.id} percent`, e.percent);
    if (e.type === 'birthday_coupon') assertSom(`birthday coupon ${e.id} max`, e.maxAmount);
  }
  const p = input.promoCode;
  if (p && !('refused' in p)) {
    if (p.minOrderTotal !== null) assertSom(`promo ${p.code} minimum`, p.minOrderTotal);
    if (p.kind === 'fixed') assertSom(`promo ${p.code} amount`, p.amount);
    else if (p.kind === 'gift') assertSom(`promo ${p.code} gift price`, p.promoGift.regular);
    else {
      assertPercent(`promo ${p.code} percent`, p.percent);
      if (p.maxDiscount !== null) assertSom(`promo ${p.code} max discount`, p.maxDiscount);
    }
  }
}

function assertSom(what: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be whole non-negative so'm: ${value}`);
  }
}

function assertPercent(what: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError(`${what} must be a whole number from 0 to 100: ${value}`);
  }
}

function sum(amounts: number[]): number {
  return amounts.reduce((a, b) => a + b, 0);
}

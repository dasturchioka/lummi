import type { PromoCodeInput, SalesFigures } from '@lummi/contracts';
import {
  and,
  birthdayCoupons,
  customers,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  regions,
  volumes,
} from '@lummi/db';
import {
  cancelByStaff,
  fulfilTo,
  pay,
  placeOrder,
  refund,
  returnWhole,
  signedIn,
  tashkent,
} from '../harness/fulfilment';
import { shopper, slugs } from '../harness/orders';
import type { TestUser } from '../harness/sign-init-data';
import type { TestApp } from '../harness/test-app';

/*
 * The TZ §10 report check (ADR 0028): twenty orders placed, paid, shipped, delivered, cancelled,
 * returned and refunded through the real doors, at set Tashkent times, and the figures the sales
 * report (#42) must show for them, worked out by hand below. Nothing here calls the report code:
 * each expected figure is the arithmetic in its comment, from the prices and rules of this file.
 *
 * The rules the hand calculation follows (docs/spec.md → Changes 2026-11-14):
 * - an order counts only while it is Fulfilled («Доставлен», not returned), on the Tashkent day it
 *   was delivered, whenever it was placed;
 * - a Refund counts on the day it was sent, and only for an order that is Fulfilled;
 * - net = items before discount − discount − refunds; delivery is never in net;
 * - average check = net ÷ orders, to the nearest so'm, halves up; none on a day without orders;
 * - a line's net = its total − its share of the order's discount: an upgrade right's sits on its
 *   line; a coupon's or promo code's is shared over the lines not marked down in proportion to
 *   their totals, rounded down, the so'm left over going to the largest remainders;
 * - a set counts per set, in its own row, never split into its five fragrances.
 *
 * The shop as the fixture sets it (so a change to the seed's placeholder prices never moves it):
 * delivery to Samarkand 25 000, free from 250 000; threshold base before the discount for an
 * upgrade right, after it for a promo code and a birthday coupon; an upgrade right is 20 %.
 */

/** The five fragrances the fixture sells: the first five seeded slugs, A to E. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
export type Letter = (typeof LETTERS)[number];
type Ml = 10 | 30 | 50;

/** Regular prices, so'm. */
export const PRICES: Record<Letter, Record<Ml, number>> = {
  A: { 10: 70_000, 30: 150_000, 50: 210_000 },
  B: { 10: 60_000, 30: 130_000, 50: 190_000 },
  C: { 10: 50_000, 30: 120_000, 50: 180_000 },
  D: { 10: 55_000, 30: 125_000, 50: 185_000 },
  E: { 10: 65_000, 30: 140_000, 50: 200_000 },
};
/** The Discovery set (composition A–E) and so the builder set too. */
export const SET_PRICE = 300_000;
/** B 30 ml is marked down to this while order 17 is placed (ADR 0008: a price, not a discount). */
export const B30_MARKDOWN = 99_900;

export const RANGE = { from: '2026-11-10', to: '2026-11-14' } as const;

const CUSTOMERS = {
  ali: { id: 4211, first_name: 'Ali', language_code: 'ru' },
  vali: { id: 4212, first_name: 'Vali', language_code: 'uz' },
  dilnoza: { id: 4213, first_name: 'Dilnoza', language_code: 'uz' },
  jasur: { id: 4214, first_name: 'Jasur', language_code: 'ru' },
  malika: { id: 4215, first_name: 'Malika', language_code: 'ru' },
  bobur: { id: 4216, first_name: 'Bobur', language_code: 'uz' },
} satisfies Record<string, TestUser>;
type Who = keyof typeof CUSTOMERS;
const PHONES: Record<Who, string> = {
  ali: '998901000011',
  vali: '998901000012',
  dilnoza: '998901000013',
  jasur: '998901000014',
  malika: '998901000015',
  bobur: '998901000016',
};

type Item =
  | { f: Letter; ml: Ml; qty?: number }
  | { set: 'discovery'; qty?: number }
  | { set: 'builder'; qty?: number };

/** What happens right after checkout: nothing, payment and acceptance, or up to BTS. */
type Then = 'unpaid' | 'accepted' | 'handed_to_bts';

type Step =
  | { at: string; order: number; who: Who; items: Item[]; promo?: string; then?: Then }
  | { at: string; deliver: number }
  | { at: string; cancel: number }
  | { at: string; return: number }
  | { at: string; refund: number; amount: number; date: string }
  | { at: string; coupon: Who; percent: number; maxAmount: number; until: string }
  | { at: string; markdown: 'B30'; price: number; until: string };

/*
 * The orders, numbered in the order they are placed (order N is the shop's 1000 + N). Totals:
 * items − discount + delivery, as the shopper is charged.
 *
 *  1 bobur   C30 120 000 + B10 60 000 = 180 000; < 250 000, delivery 25 000; total 205 000.
 *            Delivered 9 Nov (before the range). Refund 40 000 sent 11 Nov.
 *  2 ali     Discovery set 300 000; free delivery; total 300 000. Placed 8 Nov, delivered 10 Nov:
 *            opens Ali's 20 % upgrade right on A–E.
 *  3 vali    A50 210 000; delivery 25 000; total 235 000. Delivered 10 Nov, RETURNED 12 Nov,
 *            refunded in full (235 000) on 12 Nov: neither its sale nor its refund counts.
 *  4 jasur   A10 70 000; delivery 25 000; total 95 000. Delivered 10 Nov; refund 25 000 sent
 *            10 Nov (the delivery, say).
 *  5 vali    A10 70 000 + B10 60 000 = 130 000; delivery 25 000; total 155 000. Delivered 10 Nov.
 *  6 dilnoza B30 130 000, never paid, CANCELLED 11 Nov.
 *  7 ali     A30 150 000 + C10 50 000 = 200 000. Ali's upgrade right: 20 % of one A30 =
 *            30 000, on the A30 line. Base before: 200 000 < 250 000, delivery 25 000;
 *            total 200 000 − 30 000 + 25 000 = 195 000. Delivered 12 Nov.
 *  8 dilnoza B50 190 000 + A10 ×2 140 000 = 330 000. Promo BLOGER10, 10 % = 33 000; base after:
 *            297 000, free delivery; total 297 000. Delivered 12 Nov.
 *            Shares: B50 33 000 × 190/330 = 19 000; A10 33 000 × 140/330 = 14 000.
 *  9 malika  C50 180 000 + D10 55 000 = 235 000; delivery 25 000; total 260 000. Delivered
 *            12 Nov; refund 55 000 sent 14 Nov.
 * 10 jasur   Discovery set 300 000 + A50 210 000 + B50 190 000 = 700 000. Birthday coupon 20 %
 *            = 140 000, capped at 100 000; base after: 600 000, free delivery; total 600 000.
 *            Delivered 13 Nov. Shares of 100 000 over 700 000:
 *              set 300 000 → 42 857.142…; A50 210 000 → 30 000; B50 190 000 → 27 142.857…
 *              rounded down 42 857 + 30 000 + 27 142 = 99 999; the 1 left goes to the largest
 *              remainder, B50 (.857 > .142): set 42 857, A50 30 000, B50 27 143.
 * 11 jasur   A30 150 000; delivery 25 000; total 175 000 (his coupon is held by order 10).
 *            Handed to BTS, never delivered in the fixture.
 * 12 bobur   B50 190 000; delivery 25 000; total 215 000. Paid, accepted, CANCELLED 12 Nov;
 *            refunded in full (215 000) on 13 Nov: neither counts.
 * 13 malika  A10 70 000 + B10 60 000 + C10 50 000 = 180 000. Promo MINUS50, fixed 50 000; base
 *            after: 130 000, delivery 25 000; total 155 000. Delivered 13 Nov. Shares of 50 000:
 *              A10 50 000 × 70/180 = 19 444.44…; B10 × 60/180 = 16 666.66…;
 *              C10 × 50/180 = 13 888.88…; rounded down 49 998; the 2 left go to C10 (.888)
 *              and B10 (.666): A10 19 444, B10 16 667, C10 13 889.
 * 14 vali    Builder set ×2 = 600 000. Promo BLOGER10, 10 % = 60 000; base after: 540 000, free
 *            delivery; total 540 000. Delivered 13 Nov.
 * 15 bobur   Builder set ×1 = 300 000; free delivery; total 300 000. Delivered 13 Nov 23:50
 *            Tashkent (18:50 UTC): Tashkent's 13 Nov.
 * 16 vali    D30 125 000 + C10 50 000 = 175 000; delivery 25 000; total 200 000. Delivered
 *            14 Nov 00:10 Tashkent (19:10 UTC on 13 Nov): Tashkent's 14 Nov.
 * 17 dilnoza B30 marked down 99 900 + A50 210 000 + C10 50 000 = 359 900. Promo BLOGER10 on the
 *            items not marked down: 10 % of 260 000 = 26 000; base after: 333 900, free delivery;
 *            total 333 900. Delivered 14 Nov. Shares over A50 and C10 only:
 *              A50 26 000 × 210/260 = 21 000; C10 26 000 × 50/260 = 5 000; B30 0.
 * 18 ali     C30 ×2 240 000 + E10 65 000 = 305 000 (his right is spent); free delivery;
 *            total 305 000. Delivered 14 Nov.
 * 19 dilnoza C10 50 000; delivery 25 000; total 75 000. Delivered 15 Nov (after the range).
 * 20 malika  A10 70 000; delivery 25 000; total 95 000. Never paid.
 */
const STEPS: Step[] = [
  {
    at: '2026-11-07 11:00',
    order: 1,
    who: 'bobur',
    items: [
      { f: 'C', ml: 30 },
      { f: 'B', ml: 10 },
    ],
  },
  { at: '2026-11-08 10:00', order: 2, who: 'ali', items: [{ set: 'discovery' }] },
  { at: '2026-11-09 10:00', order: 3, who: 'vali', items: [{ f: 'A', ml: 50 }] },
  { at: '2026-11-09 12:00', order: 4, who: 'jasur', items: [{ f: 'A', ml: 10 }] },
  { at: '2026-11-09 16:00', deliver: 1 },
  {
    at: '2026-11-10 09:00',
    order: 5,
    who: 'vali',
    items: [
      { f: 'A', ml: 10 },
      { f: 'B', ml: 10 },
    ],
  },
  { at: '2026-11-10 10:00', deliver: 4 },
  { at: '2026-11-10 12:00', deliver: 2 },
  { at: '2026-11-10 14:00', deliver: 3 },
  { at: '2026-11-10 18:00', deliver: 5 },
  { at: '2026-11-10 19:00', refund: 4, amount: 25_000, date: '2026-11-10' },
  { at: '2026-11-11 08:00', order: 6, who: 'dilnoza', items: [{ f: 'B', ml: 30 }], then: 'unpaid' },
  { at: '2026-11-11 09:00', cancel: 6 },
  {
    at: '2026-11-11 09:30',
    coupon: 'jasur',
    percent: 20,
    maxAmount: 100_000,
    until: '2026-11-21 00:00',
  },
  {
    at: '2026-11-11 10:00',
    order: 7,
    who: 'ali',
    items: [
      { f: 'A', ml: 30 },
      { f: 'C', ml: 10 },
    ],
  },
  { at: '2026-11-11 11:00', refund: 1, amount: 40_000, date: '2026-11-11' },
  {
    at: '2026-11-11 12:00',
    order: 8,
    who: 'dilnoza',
    items: [
      { f: 'B', ml: 50 },
      { f: 'A', ml: 10, qty: 2 },
    ],
    promo: 'BLOGER10',
  },
  {
    at: '2026-11-11 15:00',
    order: 9,
    who: 'malika',
    items: [
      { f: 'C', ml: 50 },
      { f: 'D', ml: 10 },
    ],
  },
  {
    at: '2026-11-12 09:30',
    order: 10,
    who: 'jasur',
    items: [{ set: 'discovery' }, { f: 'A', ml: 50 }, { f: 'B', ml: 50 }],
  },
  { at: '2026-11-12 10:30', order: 11, who: 'jasur', items: [{ f: 'A', ml: 30 }] },
  { at: '2026-11-12 11:00', return: 3 },
  {
    at: '2026-11-12 11:05',
    order: 12,
    who: 'bobur',
    items: [{ f: 'B', ml: 50 }],
    then: 'accepted',
  },
  { at: '2026-11-12 11:15', deliver: 7 },
  { at: '2026-11-12 11:30', refund: 3, amount: 235_000, date: '2026-11-12' },
  {
    at: '2026-11-12 13:00',
    order: 13,
    who: 'malika',
    items: [
      { f: 'A', ml: 10 },
      { f: 'B', ml: 10 },
      { f: 'C', ml: 10 },
    ],
    promo: 'MINUS50',
  },
  { at: '2026-11-12 14:00', cancel: 12 },
  { at: '2026-11-12 15:00', deliver: 8 },
  {
    at: '2026-11-12 16:00',
    order: 14,
    who: 'vali',
    items: [{ set: 'builder', qty: 2 }],
    promo: 'BLOGER10',
  },
  { at: '2026-11-12 17:00', deliver: 9 },
  { at: '2026-11-13 10:00', deliver: 10 },
  { at: '2026-11-13 10:05', order: 15, who: 'bobur', items: [{ set: 'builder' }] },
  { at: '2026-11-13 12:00', deliver: 13 },
  {
    at: '2026-11-13 12:05',
    order: 16,
    who: 'vali',
    items: [
      { f: 'D', ml: 30 },
      { f: 'C', ml: 10 },
    ],
  },
  { at: '2026-11-13 12:30', refund: 12, amount: 215_000, date: '2026-11-13' },
  { at: '2026-11-13 13:55', markdown: 'B30', price: B30_MARKDOWN, until: '2026-11-13 23:59' },
  {
    at: '2026-11-13 14:00',
    order: 17,
    who: 'dilnoza',
    items: [
      { f: 'B', ml: 30 },
      { f: 'A', ml: 50 },
      { f: 'C', ml: 10 },
    ],
    promo: 'BLOGER10',
  },
  { at: '2026-11-13 16:00', deliver: 14 },
  { at: '2026-11-13 23:50', deliver: 15 },
  { at: '2026-11-14 00:10', deliver: 16 },
  {
    at: '2026-11-14 09:00',
    order: 18,
    who: 'ali',
    items: [
      { f: 'C', ml: 30, qty: 2 },
      { f: 'E', ml: 10 },
    ],
  },
  { at: '2026-11-14 10:00', order: 19, who: 'dilnoza', items: [{ f: 'C', ml: 10 }] },
  { at: '2026-11-14 15:00', deliver: 17 },
  { at: '2026-11-14 16:00', refund: 9, amount: 55_000, date: '2026-11-14' },
  { at: '2026-11-14 18:00', deliver: 18 },
  { at: '2026-11-14 20:00', order: 20, who: 'malika', items: [{ f: 'A', ml: 10 }], then: 'unpaid' },
  { at: '2026-11-15 11:00', deliver: 19 },
];

/** Figures for one day or the range, as the report must show them. */
export type Expected = SalesFigures;

/*
 * Day by day over 10–14 November (Tashkent). Orders delivered that day and still «Доставлен»;
 * refunds sent that day for such orders.
 */
export const EXPECTED_DAYS: (Expected & { day: string })[] = [
  {
    // orders 4, 2, 5 (3 was delivered today but returned). Refund of 4: 25 000.
    day: '2026-11-10',
    orders: 3,
    itemsBeforeDiscount: 500_000, // 70 000 + 300 000 + 130 000
    discount: 0,
    delivery: 50_000, // 25 000 (4) + 0 (2) + 25 000 (5)
    refunds: 25_000,
    net: 475_000, // 500 000 − 0 − 25 000
    averageCheck: 158_333, // 475 000 ÷ 3 = 158 333.33…
  },
  {
    // no delivery; the refund of order 1 (delivered 9 Nov, outside the range): 40 000
    day: '2026-11-11',
    orders: 0,
    itemsBeforeDiscount: 0,
    discount: 0,
    delivery: 0,
    refunds: 40_000,
    net: -40_000,
    averageCheck: null,
  },
  {
    // orders 7, 8, 9. Order 3's refund today does not count: 3 was returned.
    day: '2026-11-12',
    orders: 3,
    itemsBeforeDiscount: 765_000, // 200 000 + 330 000 + 235 000
    discount: 63_000, // 30 000 + 33 000 + 0
    delivery: 50_000, // 25 000 + 0 + 25 000
    refunds: 0,
    net: 702_000, // 765 000 − 63 000
    averageCheck: 234_000, // 702 000 ÷ 3
  },
  {
    // orders 10, 13, 14, 15 (23:50 Tashkent). Order 12's refund today does not count: cancelled.
    day: '2026-11-13',
    orders: 4,
    itemsBeforeDiscount: 1_780_000, // 700 000 + 180 000 + 600 000 + 300 000
    discount: 210_000, // 100 000 + 50 000 + 60 000 + 0
    delivery: 25_000, // 0 + 25 000 + 0 + 0
    refunds: 0,
    net: 1_570_000, // 1 780 000 − 210 000
    averageCheck: 392_500, // 1 570 000 ÷ 4
  },
  {
    // orders 16 (00:10 Tashkent), 17, 18. Refund of order 9 (delivered 12 Nov): 55 000.
    day: '2026-11-14',
    orders: 3,
    itemsBeforeDiscount: 839_900, // 175 000 + 359 900 + 305 000
    discount: 26_000, // 0 + 26 000 + 0
    delivery: 25_000, // 25 000 + 0 + 0
    refunds: 55_000,
    net: 758_900, // 839 900 − 26 000 − 55 000
    averageCheck: 252_967, // 758 900 ÷ 3 = 252 966.66…
  },
];

export const EXPECTED_TOTALS: Expected = {
  orders: 13, // 3 + 0 + 3 + 4 + 3
  itemsBeforeDiscount: 3_884_900, // 500 000 + 765 000 + 1 780 000 + 839 900
  discount: 299_000, // 63 000 + 210 000 + 26 000
  delivery: 150_000, // 50 000 + 50 000 + 25 000 + 25 000
  refunds: 120_000, // 25 000 + 40 000 + 55 000
  net: 3_465_900, // 3 884 900 − 299 000 − 120 000
  averageCheck: 266_608, // 3 465 900 ÷ 13 = 266 607.69…
};

/*
 * Fragrances, from the volume lines of the 13 orders (line total − its share of the discount):
 *   A: 4 A10 70 000; 5 A10 70 000; 7 A30 150 000 − 30 000 = 120 000; 8 A10 ×2 140 000 − 14 000
 *      = 126 000; 10 A50 210 000 − 30 000 = 180 000; 13 A10 70 000 − 19 444 = 50 556;
 *      17 A50 210 000 − 21 000 = 189 000.
 *      units 1 + 1 + 1 + 2 + 1 + 1 + 1 = 8; net 805 556.
 *   B: 5 B10 60 000; 8 B50 190 000 − 19 000 = 171 000; 10 B50 190 000 − 27 143 = 162 857;
 *      13 B10 60 000 − 16 667 = 43 333; 17 B30 99 900.
 *      units 5; net 537 090.
 *   C: 7 C10 50 000; 9 C50 180 000; 13 C10 50 000 − 13 889 = 36 111; 16 C10 50 000;
 *      17 C10 50 000 − 5 000 = 45 000; 18 C30 ×2 240 000.
 *      units 7; net 601 111.
 *   D: 9 D10 55 000; 16 D30 125 000. units 2; net 180 000.
 *   E: 18 E10 65 000. units 1; net 65 000.
 * Most units first: A 8, C 7, B 5, D 2, E 1.
 */
export const EXPECTED_FRAGRANCES: { f: Letter; units: number; net: number }[] = [
  { f: 'A', units: 8, net: 805_556 },
  { f: 'C', units: 7, net: 601_111 },
  { f: 'B', units: 5, net: 537_090 },
  { f: 'D', units: 2, net: 180_000 },
  { f: 'E', units: 1, net: 65_000 },
];

/*
 * Volumes, the same lines by bottle size:
 *   A10 4, 5, 8 (×2), 13: units 5; 70 000 + 70 000 + 126 000 + 50 556 = 316 556.
 *   C10 7, 13, 16, 17: units 4; 50 000 + 36 111 + 50 000 + 45 000 = 181 111.
 *   A50 10, 17: units 2; 180 000 + 189 000 = 369 000.
 *   B50 8, 10: units 2; 171 000 + 162 857 = 333 857.
 *   C30 18 (×2): units 2; 240 000.
 *   B10 5, 13: units 2; 60 000 + 43 333 = 103 333.
 *   C50 9: 180 000. D30 16: 125 000. A30 7: 120 000. B30 17: 99 900. E10 18: 65 000.
 *   D10 9: 55 000 (one unit each).
 * Most units first, then most net.
 */
export const EXPECTED_VOLUMES: { f: Letter; ml: Ml; units: number; net: number }[] = [
  { f: 'A', ml: 10, units: 5, net: 316_556 },
  { f: 'C', ml: 10, units: 4, net: 181_111 },
  { f: 'A', ml: 50, units: 2, net: 369_000 },
  { f: 'B', ml: 50, units: 2, net: 333_857 },
  { f: 'C', ml: 30, units: 2, net: 240_000 },
  { f: 'B', ml: 10, units: 2, net: 103_333 },
  { f: 'C', ml: 50, units: 1, net: 180_000 },
  { f: 'D', ml: 30, units: 1, net: 125_000 },
  { f: 'A', ml: 30, units: 1, net: 120_000 },
  { f: 'B', ml: 30, units: 1, net: 99_900 },
  { f: 'E', ml: 10, units: 1, net: 65_000 },
  { f: 'D', ml: 10, units: 1, net: 55_000 },
];

/*
 * Sets, one unit per set:
 *   Discovery: 2 (300 000) + 10 (300 000 − 42 857 = 257 143): units 2; net 557 143.
 *   Builder: 14 (×2, 600 000 − 60 000 = 540 000) + 15 (300 000): units 3; net 840 000.
 * Check: fragrances 805 556 + 601 111 + 537 090 + 180 000 + 65 000 = 2 188 757, sets
 * 557 143 + 840 000 = 1 397 143, together 3 585 900 = items 3 884 900 − discount 299 000: every
 * so'm of the items, less the discount, lands on exactly one row.
 */
export const EXPECTED_SETS = [
  { kind: 'discovery_set', units: 2, net: 557_143 },
  { kind: 'builder_set', units: 3, net: 840_000 },
] as const;

/** The fixture's own catalog: A–E by slug with their ids, as the report names them. */
export interface FixtureCatalog {
  slug: Record<Letter, string>;
  fragranceId: Record<Letter, number>;
  volumeId: Record<`${Letter}${Ml}`, number>;
}

/** Prices, the Discovery set, delivery and the rules the hand calculation above relies on. */
async function setUpShop(t: TestApp): Promise<FixtureCatalog> {
  const picked = await slugs(t, LETTERS.length);
  const catalog = { slug: {}, fragranceId: {}, volumeId: {} } as FixtureCatalog;
  for (const [i, letter] of LETTERS.entries()) {
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, picked[i]!));
    catalog.slug[letter] = f!.slug;
    catalog.fragranceId[letter] = f!.id;
    for (const ml of [10, 30, 50] as const) {
      const [v] = await t.db
        .update(volumes)
        .set({ price: PRICES[letter][ml], salePrice: null, saleEndsAt: null, onHand: 20 })
        .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, ml)))
        .returning();
      catalog.volumeId[`${letter}${ml}`] = v!.id;
    }
  }
  await t.db.update(discoverySet).set({ price: SET_PRICE, onHand: 10, isPlaceholder: false });
  await t.db.delete(discoverySetItems);
  await t.db
    .insert(discoverySetItems)
    .values(LETTERS.map((l, i) => ({ position: i + 1, fragranceId: catalog.fragranceId[l] })));
  await t.db.update(regions).set({ deliveryTariff: 25_000 });

  const owner = await t.ownerSession();
  const settings: [string, unknown][] = [
    ['pricing.freeDeliveryThreshold', 250_000],
    [
      'pricing.thresholdBase',
      {
        upgradeRight: { set: 'before', single_10ml: 'before' },
        promoCode: 'after',
        birthdayCoupon: 'after',
      },
    ],
    ['pricing.discountsApplyToMarkedDown', { upgradeRight: false, birthdayCoupon: false }],
    ['upgradeRights.set.enabled', true],
    ['upgradeRights.set.percent', 20],
    ['upgradeRights.single10ml.enabled', false],
  ];
  for (const [key, value] of settings) {
    const res = await fetch(`${t.baseUrl}/admin/settings/${key}`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (res.status !== 200) throw new Error(`setting ${key}: ${res.status}`);
  }
  const code = (c: Partial<PromoCodeInput> & Pick<PromoCodeInput, 'code' | 'kind'>) => ({
    percent: null,
    amount: null,
    maxDiscount: null,
    expiresOn: null,
    minOrderTotal: null,
    totalLimit: null,
    perCustomerLimit: null,
    newCustomersOnly: false,
    appliesToMarkedDown: false,
    active: true,
    ...c,
  });
  for (const body of [
    code({ code: 'BLOGER10', kind: 'percent', percent: 10 }),
    code({ code: 'MINUS50', kind: 'fixed', amount: 50_000 }),
  ]) {
    const res = await owner.client.admin.promoCodes.create({ body });
    if (res.status !== 201) throw new Error(`promo ${body.code}: ${res.status}`);
  }
  return catalog;
}

/**
 * Runs the twenty orders on the fake clock and leaves it at 15 November, 12:00 Tashkent.
 * Returns the catalog and the shop's number of each fixture order (1 → its number).
 */
export async function placeTwentyOrders(t: TestApp) {
  t.edges.clock.set(tashkent('2026-11-07 10:00'));
  const catalog = await setUpShop(t);
  for (const who of Object.keys(CUSTOMERS) as Who[]) await shopper(t, CUSTOMERS[who], PHONES[who]);

  const numbers = new Map<number, number>();
  const numberOf = (n: number) => {
    const number = numbers.get(n);
    if (number === undefined) throw new Error(`order ${n} was not placed`);
    return number;
  };
  for (const step of STEPS) {
    t.edges.clock.set(tashkent(step.at));
    if ('order' in step) {
      const client = await signedIn(t, CUSTOMERS[step.who]);
      for (const item of step.items) {
        const res =
          'f' in item
            ? await client.cart.addLine({
                body: { slug: catalog.slug[item.f], ml: item.ml, qty: item.qty ?? 1 },
              })
            : item.set === 'discovery'
              ? await client.cart.addDiscovery({ body: { qty: item.qty ?? 1 } })
              : await client.cart.addBuilder({
                  body: { slugs: LETTERS.map((l) => catalog.slug[l]), qty: item.qty ?? 1 },
                });
        if (res.status !== 200) throw new Error(`order ${step.order}: add ${res.status}`);
      }
      if (step.promo) {
        const res = await client.cart.applyPromoCode({ body: { code: step.promo } });
        if (res.status !== 200) throw new Error(`order ${step.order}: promo ${res.status}`);
      }
      const order = await placeOrder(t, client);
      numbers.set(step.order, order.number);
      const then = step.then ?? 'handed_to_bts';
      if (then === 'unpaid') continue;
      await pay(t, order.number);
      await fulfilTo(t, order.number, then);
    } else if ('deliver' in step) await fulfilTo(t, numberOf(step.deliver), 'delivered');
    else if ('cancel' in step) await cancelByStaff(t, numberOf(step.cancel), 'out_of_stock');
    else if ('return' in step)
      await returnWhole(t, numberOf(step.return), 'Покупатель вернул посылку целиком');
    else if ('refund' in step) await refund(t, numberOf(step.refund), step.amount, step.date);
    else if ('coupon' in step) {
      const [c] = await t.db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.telegramId, CUSTOMERS[step.coupon].id));
      await t.db.insert(birthdayCoupons).values({
        customerId: c!.id,
        birthdayYear: 2026,
        birthday: '2026-11-14',
        percent: step.percent,
        maxAmount: step.maxAmount,
        issuedAt: tashkent(step.at),
        expiresAt: tashkent(step.until),
      });
    } else {
      await t.db
        .update(volumes)
        .set({ salePrice: step.price, saleEndsAt: tashkent(step.until) })
        .where(eq(volumes.id, catalog.volumeId.B30));
    }
  }
  t.edges.clock.set(tashkent('2026-11-15 12:00'));
  return { catalog, numberOf };
}

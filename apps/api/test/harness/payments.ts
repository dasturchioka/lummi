import { internalContract, utcToTashkent } from '@lummi/contracts';
import { initClient } from '@ts-rest/core';
import sharp from 'sharp';
import { PaymentConfirmation } from '../../src/payment/payment-confirmation';
import { TEST_INTERNAL_SECRET, TEST_SHOP_CARD, type TestApp } from './test-app';

/** The shop card's last 4 digits in tests: credits to it are candidates, others never. */
export const SHOP_LAST4 = TEST_SHOP_CARD.number.slice(-4);

/** `75750` → `75.750` (Humo writes thousands with dots). */
const thousands = (som: number) => String(som).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const two = (n: number) => String(n).padStart(2, '0');

/** A ➕ Humo message as the official bot writes it (spec Changes 2026-11-07), at a Tashkent minute. */
export function creditText(opts: { som: number; tiyin?: number; at: Date; last4?: string }) {
  const t = utcToTashkent(opts.at);
  return [
    "💸 To'lov",
    `➕ ${thousands(opts.som)},${two(opts.tiyin ?? 0)} UZS`,
    '📍 CLICK P2P HUMO2UZCAR',
    `💳 HUMOCARD *${opts.last4 ?? SHOP_LAST4}`,
    `🕓 ${two(t.hour)}:${two(t.minute)} ${two(t.day)}.${two(t.month)}.${t.year}`,
    '💰 1.234.567,89 UZS',
  ].join('\n');
}

let nextMessageId = 1;

const internalClient = (t: TestApp) =>
  initClient(internalContract, {
    baseUrl: t.baseUrl,
    baseHeaders: { 'x-internal-secret': TEST_INTERNAL_SECRET },
    throwOnUnknownStatus: true,
  });

/** The userbot's heartbeat (ADR 0014), at the fake clock's now. */
export async function userbotHeartbeat(t: TestApp): Promise<void> {
  const res = await internalClient(t).userbotHeartbeat({ body: {} });
  if (res.status !== 200) throw new Error(`heartbeat: ${res.status}`);
}

/**
 * A Credit recorded the way production records one: the userbot posts the Humo message to the
 * internal endpoint (ADR 0014), which queues the "credit recorded" event. `at` defaults to the
 * fake clock's now; Humo keeps only the minute.
 */
export async function recordCredit(
  t: TestApp,
  opts: { som: number; tiyin?: number; at?: Date; last4?: string; messageId?: number },
): Promise<number> {
  const res = await internalClient(t).humoMessage({
    body: {
      messageId: opts.messageId ?? nextMessageId++,
      text: creditText({ ...opts, at: opts.at ?? t.edges.clock.now() }),
    },
  });
  if (res.status !== 200 || res.body.creditId === null)
    throw new Error(`credit not recorded: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.creditId;
}

/**
 * Pays an order the way production does (ADR 0012): a Credit for its amount due arrives, and the
 * receipt AI confirms the order's receipt with it through `PaymentConfirmation`.
 */
export async function payWithCredit(
  t: TestApp,
  order: { id: number; amountDue: number },
  receiptId: number,
): Promise<number> {
  const creditId = await recordCredit(t, { som: order.amountDue });
  const out = await t.app
    .get(PaymentConfirmation)
    .confirmPayment({ orderId: order.id, creditId, receiptId, actor: { type: 'ai' } });
  if (out.kind !== 'confirmed') throw new Error(`confirm_payment: ${out.kind}`);
  return creditId;
}

let uploads = 0;
/**
 * A receipt-like screenshot that no other upload of the run shares: dark bars whose widths spell
 * a counter, so both its SHA-256 and its perceptual hash differ. Two orders sending the same file
 * is a duplicate (#32, #36) and never confirms itself.
 */
export function uniqueReceiptImage(width = 600, height = 1200): Promise<Buffer> {
  uploads += 1;
  const bars = Array.from({ length: 12 }, (_, i) => {
    const on = (uploads >> i) & 1;
    const w = Math.round(width * (on ? 0.8 : 0.3));
    const y = Math.round((height / 14) * (i + 1));
    return `<rect x="${Math.round(width * 0.08)}" y="${y}" width="${w}" height="${Math.round(height / 40)}" fill="#222"/>`;
  }).join('');
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${bars}</svg>`,
    ),
  )
    .png()
    .toBuffer();
}

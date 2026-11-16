import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CampaignLinkInput, PromoCodeInput } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  auditLog,
  campaignLinks,
  campaignOpens,
  customers,
  eq,
  fragrances,
  orders,
  promoCodes,
} from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { samarkandPoint } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) for campaign links (ticket #35, ADR 0022): the owner's CRUD and QR, the open
 * that logs, routes and prefills, and attribution on orders and customers. The attribution window
 * is exactly N x 24 h before the order (an open exactly N x 24 h old still counts).
 */
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;
const DAY = 86_400_000;

let t: TestApp;
let owner: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

function link(over: Partial<CampaignLinkInput> = {}): CampaignLinkInput {
  return {
    code: 'insta-nov',
    target: 'catalog',
    promoCode: null,
    source: 'instagram',
    sourceLabel: null,
    ...over,
  };
}
async function createLink(over: Partial<CampaignLinkInput> = {}) {
  const res = await owner.client.admin.campaignLinks.create({ body: link(over) });
  if (res.status !== 201) throw new Error(`create link: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
function promo(over: Partial<PromoCodeInput> = {}): PromoCodeInput {
  return {
    code: 'BLOGER10',
    kind: 'percent',
    percent: 10,
    amount: null,
    maxDiscount: null,
    expiresOn: null,
    minOrderTotal: null,
    totalLimit: null,
    perCustomerLimit: null,
    newCustomersOnly: false,
    appliesToMarkedDown: false,
    active: true,
    ...over,
  };
}
async function createPromo(over: Partial<PromoCodeInput> = {}) {
  const res = await owner.client.admin.promoCodes.create({ body: promo(over) });
  if (res.status !== 201) throw new Error(`promo: ${res.status}`);
  return res.body;
}

async function shopper(user: TestUser = ali, phone = '998901234567') {
  const { client } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  if ((await client.me.shareContact({ body: { proof } })).status !== 200)
    throw new Error('contact');
  const s = {
    client,
    open: async (code: string) => {
      await s.relogin(); // days may have passed since the last call
      return s.client.campaigns.open({ body: { code } });
    },
    /** Days pass between an open and an order: the session has expired by then. */
    async relogin() {
      s.client = (await t.signIn(user)).client;
    },
  };
  return s;
}
type Shopper = Awaited<ReturnType<typeof shopper>>;

async function slug() {
  const [row] = await t.db
    .select({ slug: fragrances.slug })
    .from(fragrances)
    .orderBy(fragrances.slug)
    .limit(1);
  return row!.slug;
}
async function placeOrder(s: Shopper) {
  await s.relogin();
  const add = await s.client.cart.addLine({ body: { slug: await slug(), ml: 30, qty: 1 } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  const point = await samarkandPoint(t);
  const checkout = await s.client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await s.client.orders.create({
    body: {
      recipientName: 'Ali Valiyev',
      recipientPhone: '+998901234567',
      delivery: { kind: 'point', pointId: point.id },
      consent: true,
      confirmedTotal: checkout.body.quote.total,
      confirmedDiscount: checkout.body.quote.discount,
      idempotencyKey: randomUUID(),
    },
  });
  if (res.status !== 201) throw new Error(`order ${res.status} ${JSON.stringify(res.body)}`);
  const [row] = await t.db.select().from(orders).where(eq(orders.number, res.body.number));
  return row!;
}
/** The code of the link a promo code was given automatically: random, never derived from the promo code. */
async function autoCode(promo: string) {
  const [row] = await t.db
    .select({ code: campaignLinks.code })
    .from(campaignLinks)
    .innerJoin(promoCodes, eq(promoCodes.id, campaignLinks.promoCodeId))
    .where(eq(promoCodes.code, promo));
  return row!.code;
}
const customerRow = async (telegramId: number) =>
  (await t.db.select().from(customers).where(eq(customers.telegramId, telegramId)))[0]!;

describe('admin: campaign links are the owner’s', () => {
  it('creates a link with its code, target, source and the QR link, audited', async () => {
    const created = await createLink({ source: 'store_qr', sourceLabel: 'Стойка в ТЦ' });
    expect(created).toMatchObject({
      code: 'insta-nov',
      target: 'catalog',
      source: 'store_qr',
      sourceLabel: 'Стойка в ТЦ',
      opens: 0,
      orders: 0,
      url: 'https://t.me/lummi_dev_bot?startapp=l_insta-nov',
    });
    expect(await audits('campaign_link.created')).toHaveLength(1);
  });

  it('generates a code when none is given and takes a fragrance as the target', async () => {
    const created = await createLink({ code: undefined, target: `p_${await slug()}` });
    expect(created.code).toMatch(/^[a-z0-9]{8}$/);
  });

  it('refuses a bad target, a bad code, a taken code (any case) and an unknown promo code', async () => {
    const c = owner.client.admin.campaignLinks;
    await createLink();
    expect((await c.create({ body: link({ code: 'x y!' }) })).status).toBe(400); // body validation is ts-rest's own
    expect((await c.create({ body: link({ code: 'b-code', target: 'l_other' }) })).status).toBe(
      400,
    );
    expect((await c.create({ body: link({ code: 'b-code', target: '/admin' }) })).status).toBe(400);
    expect(await c.create({ body: link({ code: 'INSTA-NOV' }) })).toMatchObject({
      status: 409,
      body: { code: 'code_taken' },
    });
    expect(await c.create({ body: link({ code: 'b-code', promoCode: 'NOSUCH' }) })).toMatchObject({
      status: 422,
      body: { code: 'unknown_promo_code' },
    });
  });

  it('edits a link, and fixes its code once someone opened it', async () => {
    const created = await createLink();
    const c = owner.client.admin.campaignLinks;
    const edited = await c.update({
      params: { id: created.id },
      body: link({ code: 'insta-dec', source: 'blogger', sourceLabel: 'Иван' }),
    });
    expect(edited).toMatchObject({ status: 200, body: { code: 'insta-dec', source: 'blogger' } });
    expect(await audits('campaign_link.updated')).toHaveLength(1);

    await (await shopper()).open('insta-dec');
    expect(
      await c.update({ params: { id: created.id }, body: link({ code: 'insta-new' }) }),
    ).toMatchObject({
      status: 409,
      body: { code: 'code_locked' },
    });
    // the target and source still change after an open
    expect(
      (
        await c.update({
          params: { id: created.id },
          body: link({ code: 'insta-dec', target: 'builder' }),
        })
      ).status,
    ).toBe(200);
  });

  it('deletes a link nobody opened; an opened one stays', async () => {
    const a = await createLink({ code: 'unused' });
    const b = await createLink({ code: 'used-one' });
    await (await shopper()).open('used-one');
    const c = owner.client.admin.campaignLinks;
    expect((await c.remove({ params: { id: a.id } })).status).toBe(200);
    expect(await c.remove({ params: { id: b.id } })).toMatchObject({
      status: 409,
      body: { code: 'in_use' },
    });
    expect(await audits('campaign_link.deleted')).toHaveLength(1);
  });

  it('answers a manager 403 on every route, the QR included', async () => {
    const created = await createLink();
    const m = await t.managerSession();
    const c = m.client.admin.campaignLinks;
    const calls = [
      c.list(),
      c.get({ params: { id: created.id } }),
      c.create({ body: link({ code: 'other-one' }) }),
      c.update({ params: { id: created.id }, body: link() }),
      c.remove({ params: { id: created.id } }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    const qr = await fetch(`${t.baseUrl}/admin/campaign-links/${created.id}/qr`, {
      headers: { cookie: m.cookie },
    });
    expect(qr.status).toBe(403);
    const anon = await fetch(`${t.baseUrl}/admin/campaign-links/${created.id}/qr`);
    expect(anon.status).toBe(401);
  });

  it('downloads the QR as a PNG, or an SVG', async () => {
    const created = await createLink();
    const png = await fetch(`${t.baseUrl}/admin/campaign-links/${created.id}/qr`, {
      headers: { cookie: owner.cookie },
    });
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-disposition')).toContain('lummi-insta-nov.png');
    const bytes = Buffer.from(await png.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');

    const svg = await fetch(`${t.baseUrl}/admin/campaign-links/${created.id}/qr?format=svg`, {
      headers: { cookie: owner.cookie },
    });
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');
    expect(await svg.text()).toContain('<svg');
    expect(
      (
        await fetch(`${t.baseUrl}/admin/campaign-links/999/qr`, {
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(404);
  });
});

describe('every promo code has a link', () => {
  it('a new code gets one that prefills it; the code and its link live and die together', async () => {
    const created = await createPromo();
    const list = await owner.client.admin.campaignLinks.list();
    expect(list.status === 200 && list.body).toMatchObject([
      { promoCode: 'BLOGER10', target: 'catalog', source: 'promo_code', sourceLabel: 'BLOGER10' },
    ]);
    // deleting an unused promo code takes its unopened link along
    await owner.client.admin.promoCodes.remove({ params: { id: created.id } });
    const after = await owner.client.admin.campaignLinks.list();
    expect(after.status === 200 && after.body).toEqual([]);
  });

  it('a link made by hand for a code does not stop the code from having its own', async () => {
    await createPromo({ code: 'AAA111' });
    const list = await owner.client.admin.campaignLinks.list();
    expect(list.status === 200 && list.body).toHaveLength(1);
  });

  it('gives the link a random code, never one derived from the promo code', async () => {
    await createPromo();
    const code = await autoCode('BLOGER10');
    expect(code).toMatch(/^[a-z0-9]{8}$/);
    expect(code).not.toContain('bloger');
  });

  it('backfills codes that predate links, and running it again adds nothing', async () => {
    await createPromo({ code: 'OLD1' });
    await createPromo({ code: 'OLD2' });
    // as if both predate the feature: no link, not yet marked
    await t.db.delete(campaignLinks);
    await t.db.update(promoCodes).set({ campaignLinkMade: false });
    const svc = t.app.get(CampaignsService);
    expect(await svc.backfillPromoLinks()).toBe(2);
    expect(await svc.backfillPromoLinks()).toBe(0);
    expect(await t.db.select().from(campaignLinks)).toHaveLength(2);
  });

  it('never recreates an automatic link the owner deleted', async () => {
    await createPromo();
    const [link] = await t.db.select().from(campaignLinks);
    expect(
      (await owner.client.admin.campaignLinks.remove({ params: { id: link!.id } })).status,
    ).toBe(200);
    expect(await t.app.get(CampaignsService).backfillPromoLinks()).toBe(0);
    expect(await t.db.select().from(campaignLinks)).toHaveLength(0);
  });

  it('two overlapping backfills make one link per code', async () => {
    for (const code of ['AAA1', 'BBB2', 'CCC3']) await createPromo({ code });
    await t.db.delete(campaignLinks);
    await t.db.update(promoCodes).set({ campaignLinkMade: false });
    const svc = t.app.get(CampaignsService);
    const made = await Promise.all([svc.backfillPromoLinks(), svc.backfillPromoLinks()]);
    expect(made.reduce((a, b) => a + b, 0)).toBe(3);
    expect(await t.db.select().from(campaignLinks)).toHaveLength(3);
  });

  it('re-keys an old automatic link whose code was the promo code’s own', async () => {
    await createPromo({ code: 'LEGACY1' });
    await t.db.update(campaignLinks).set({ code: 'legacy1' });
    expect(await t.app.get(CampaignsService).backfillPromoLinks()).toBe(0);
    expect(await autoCode('LEGACY1')).toMatch(/^[a-z0-9]{8}$/);
    expect(await autoCode('LEGACY1')).not.toBe('legacy1');
  });
});

describe('opening l_<code>', () => {
  it('logs the open, returns the target and counts unique customers', async () => {
    await createLink({ target: `p_${await slug()}` });
    const s = await shopper();
    const res = await s.open('insta-nov');
    expect(res).toMatchObject({
      status: 200,
      body: { target: `p_${await slug()}`, promoCodePrefilled: false },
    });
    await s.open('insta-nov'); // a repeat within a minute is not logged again
    expect(await t.db.select().from(campaignOpens)).toHaveLength(1);
    t.edges.clock.advance(61_000);
    await s.open('insta-nov');
    await (await shopper(vali, '998901234568')).open('insta-nov');
    expect(await t.db.select().from(campaignOpens)).toHaveLength(3);
    const list = await owner.client.admin.campaignLinks.list();
    expect(list.status === 200 && list.body[0]).toMatchObject({ opens: 2, everOpened: true });
  });

  it('an unknown code is a 404 and logs nothing: the app lands on Home', async () => {
    const s = await shopper();
    expect(await s.open('nope-nope')).toMatchObject({ status: 404 });
    expect(await t.db.select().from(campaignOpens)).toHaveLength(0);
  });

  it('needs a signed-in customer', async () => {
    await createLink();
    const res = await t.client.campaigns.open({ body: { code: 'insta-nov' } });
    expect(res.status).toBe(401);
  });

  it('prefills the link’s promo code in the cart, through the same quote as a typed one', async () => {
    await createPromo();
    const s = await shopper();
    await s.client.cart.addLine({ body: { slug: await slug(), ml: 30, qty: 1 } });
    const res = await s.open(await autoCode('BLOGER10'));
    expect(res).toMatchObject({ status: 200, body: { promoCodePrefilled: true } });
    const cart = await s.client.cart.get();
    expect(cart.status === 200 && cart.body.promoCode).toBe('BLOGER10');
    expect(cart.status === 200 && cart.body.quote.discount).toMatchObject({
      type: 'promo_code',
      code: 'BLOGER10',
    });
  });

  it('a link without a promo code leaves the cart’s own code alone', async () => {
    await createPromo();
    await createLink();
    const s = await shopper();
    await s.client.cart.applyPromoCode({ body: { code: 'bloger10' } });
    await s.open('insta-nov');
    const cart = await s.client.cart.get();
    expect(cart.status === 200 && cart.body.promoCode).toBe('BLOGER10');
  });

  it('a typed code in the cart is replaced by the link’s: the latest tap is the intent', async () => {
    await createPromo();
    await createPromo({ code: 'TYPED5', percent: 5 });
    const s = await shopper();
    await s.client.cart.applyPromoCode({ body: { code: 'typed5' } });
    await s.open(await autoCode('BLOGER10'));
    const cart = await s.client.cart.get();
    expect(cart.status === 200 && cart.body.promoCode).toBe('BLOGER10');
  });

  it('guessing codes through the open spends the same attempts as typing, then 429s', async () => {
    await createPromo();
    const found = await autoCode('BLOGER10');
    const set = await owner.client.admin.settings.update({
      params: { key: 'promo.attemptLimit' },
      body: { value: 2 },
    });
    expect(set.status).toBe(200);
    const s = await shopper();
    expect((await s.open('guess-one')).status).toBe(404);
    expect((await s.open('guess-two')).status).toBe(404);
    // past the budget even a real code is refused, so the answer is no oracle
    expect(await s.open('guess-three')).toMatchObject({
      status: 429,
      body: { code: 'too_many_attempts' },
    });
    expect((await s.open(found)).status).toBe(429);
    // typing shares the same window
    expect((await s.client.cart.applyPromoCode({ body: { code: 'ONE' } })).status).toBe(429);
  });

  it('a prefill is not a typed attempt: the customer still has every attempt', async () => {
    await createPromo();
    const s = await shopper();
    await s.open(await autoCode('BLOGER10'));
    for (let i = 0; i < 10; i++) {
      const r = await s.client.cart.applyPromoCode({ body: { code: `GUESS${i}` } });
      expect(r.status).toBe(200);
    }
    expect((await s.client.cart.applyPromoCode({ body: { code: 'ONEMORE' } })).status).toBe(429);
  });
});

describe('attribution', () => {
  it('an order takes the last link opened within the window, and a link opened later wins', async () => {
    await createLink({ code: 'first-link' });
    const b = await createLink({ code: 'second-link', source: 'blogger', sourceLabel: 'Иван' });
    const s = await shopper();
    await s.open('first-link');
    t.edges.clock.advance(2 * DAY);
    await s.open('second-link');
    t.edges.clock.advance(3 * DAY);
    const order = await placeOrder(s);
    expect(order.campaignLinkId).toBe(b.id);
    const list = await owner.client.admin.campaignLinks.list();
    expect(list.status === 200 && list.body.find((l) => l.id === b.id)).toMatchObject({
      orders: 1,
    });
  });

  it('counts an open exactly 7 x 24 h old and ignores one a second older', async () => {
    const a = await createLink({ code: 'edge-link' });
    const s = await shopper();
    await s.open('edge-link');
    t.edges.clock.advance(7 * DAY);
    expect((await placeOrder(s)).campaignLinkId).toBe(a.id);

    const late = await shopper(vali, '998901234568');
    await late.open('edge-link');
    t.edges.clock.advance(7 * DAY + 1000);
    expect((await placeOrder(late)).campaignLinkId).toBeNull();
  });

  it('follows the setting for the window', async () => {
    const a = await createLink({ code: 'win-link' });
    const set = await owner.client.admin.settings.update({
      params: { key: 'campaigns.attributionWindowDays' },
      body: { value: 2 },
    });
    expect(set.status).toBe(200);
    const s = await shopper();
    await s.open('win-link');
    t.edges.clock.advance(3 * DAY);
    expect((await placeOrder(s)).campaignLinkId).toBeNull();
    await s.open('win-link');
    t.edges.clock.advance(1 * DAY);
    expect((await placeOrder(s)).campaignLinkId).toBe(a.id);
  });

  it('a customer who never opened a link orders with no source', async () => {
    const s = await shopper();
    expect((await placeOrder(s)).campaignLinkId).toBeNull();
  });

  it('a customer keeps the first link they ever opened, whatever comes after', async () => {
    const a = await createLink({ code: 'first-link' });
    await createLink({ code: 'second-link' });
    const s = await shopper();
    expect((await customerRow(ali.id)).acquisitionLinkId).toBeNull();
    await s.open('first-link');
    t.edges.clock.advance(30 * DAY);
    await s.open('second-link');
    await s.open('first-link');
    expect((await customerRow(ali.id)).acquisitionLinkId).toBe(a.id);
  });

  it('an invalid prefilled code shows its reason and the source stays on the order', async () => {
    await createPromo({ active: false });
    const link = (await t.db.select().from(campaignLinks))[0]!;
    const s = await shopper();
    await s.client.cart.addLine({ body: { slug: await slug(), ml: 30, qty: 1 } });
    expect(await s.open(await autoCode('BLOGER10'))).toMatchObject({
      status: 200,
      body: { promoCodePrefilled: true },
    });
    const cart = await s.client.cart.get();
    expect(cart.status === 200 && cart.body.quote.promoCode).toEqual({
      code: 'BLOGER10',
      invalid: { reason: 'inactive' },
    });
    expect(cart.status === 200 && cart.body.quote.discount).toBeNull();
    const order = await placeOrder(s);
    expect(order.campaignLinkId).toBe(link.id);
    expect(order.discountAmount).toBe(0);
    expect((await customerRow(ali.id)).acquisitionLinkId).toBe(link.id);
  });
});

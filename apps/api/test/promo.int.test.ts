import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody, PromoCodeInput } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { and, auditLog, btsPoints, eq, fragrances, regions, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) for promo codes (ticket #29): the owner's admin, the cart's code field, the
 * use held by `createOrder` under the code's row lock, and the cancel that voids it. Seed prices:
 * 10 ml 69 000, 30 ml 149 000, 50 ml 219 000; the default tariff 25 000 below 250 000.
 */
const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let owner: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const HOUR = 3600_000;

const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

/** A percent code with no limits, active; `over` changes any field. */
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
  if (res.status !== 201) throw new Error(`create promo: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

describe('admin: promo codes are the owner’s', () => {
  it('creates a code trimmed and upper-case, with every field, audited', async () => {
    const res = await owner.client.admin.promoCodes.create({
      body: promo({
        code: '  bloger10 ',
        maxDiscount: 30_000,
        expiresOn: '2026-11-30',
        minOrderTotal: 150_000,
        totalLimit: 100,
        perCustomerLimit: 1,
        newCustomersOnly: true,
        appliesToMarkedDown: true,
      }),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'BLOGER10',
      kind: 'percent',
      percent: 10,
      amount: null,
      maxDiscount: 30_000,
      expiresOn: '2026-11-30',
      minOrderTotal: 150_000,
      totalLimit: 100,
      perCustomerLimit: 1,
      newCustomersOnly: true,
      appliesToMarkedDown: true,
      active: true,
      uses: 0,
      everUsed: false,
      state: 'active',
    });
    const [entry] = await audits('promo.created');
    expect(entry).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'promo_code',
      payload: { code: 'BLOGER10' },
    });

    const list = await owner.client.admin.promoCodes.list();
    expect(list.status === 200 && list.body.map((p) => p.code)).toEqual(['BLOGER10']);
  });

  it('refuses a code that exists in another case (409) and one that breaks the rules (400)', async () => {
    await createPromo({ code: 'LUMMI10' });
    const dup = await owner.client.admin.promoCodes.create({ body: promo({ code: 'lummi10' }) });
    expect(dup).toMatchObject({ status: 409, body: { code: 'code_taken' } });

    // the contract's body schema refuses these before the handler
    const post = (body: PromoCodeInput) =>
      fetch(`${t.baseUrl}/admin/promo-codes`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const fixedWithPercent = promo({ code: 'MINUS20', kind: 'fixed', percent: 10, amount: 20_000 });
    expect((await post(fixedWithPercent)).status).toBe(400);
    expect((await post(promo({ code: 'ЛУММИ' }))).status).toBe(400);
    expect((await post(promo({ code: 'AB' }))).status).toBe(400);
    expect((await post(promo({ code: 'MINUS20', kind: 'fixed', percent: null, amount: 20_000 }))).status).toBe(201);
    expect(await owner.client.admin.promoCodes.list()).toMatchObject({
      body: [{ code: 'MINUS20', kind: 'fixed', amount: 20_000 }, { code: 'LUMMI10' }],
    });
  });

  it('edits a code with the changed fields in the audit; a save that changes nothing writes nothing', async () => {
    const created = await createPromo();
    const same = await owner.client.admin.promoCodes.update({
      params: { id: created.id },
      body: promo(),
    });
    expect(same.status).toBe(200);
    expect(await audits('promo.updated')).toHaveLength(0);

    const res = await owner.client.admin.promoCodes.update({
      params: { id: created.id },
      body: promo({ percent: 15, active: false }),
    });
    expect(res).toMatchObject({ status: 200, body: { percent: 15, active: false, state: 'inactive' } });
    const [entry] = await audits('promo.updated');
    expect(entry?.payload).toEqual({
      code: 'BLOGER10',
      changed: { percent: [10, 15], active: [true, false] },
    });
  });

  it('deletes a code no order took, audited', async () => {
    const created = await createPromo();
    const res = await owner.client.admin.promoCodes.remove({ params: { id: created.id } });
    expect(res.status).toBe(200);
    expect(await owner.client.admin.promoCodes.list()).toMatchObject({ body: [] });
    expect(await audits('promo.deleted')).toHaveLength(1);
  });

  it('answers a manager 403 on every promo route', async () => {
    const created = await createPromo();
    const m = (await t.managerSession()).client.admin.promoCodes;
    const calls = [
      m.list(),
      m.get({ params: { id: created.id } }),
      m.create({ body: promo({ code: 'OTHER1' }) }),
      m.update({ params: { id: created.id }, body: promo() }),
      m.remove({ params: { id: created.id } }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });
});

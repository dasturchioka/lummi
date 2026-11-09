import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, eq, settings } from '@lummi/db';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe('admin settings (owner only)', () => {
  it('lists every registered setting with its effective value', async () => {
    const owner = await t.ownerSession();
    const res = await owner.client.admin.settings.list();
    expect(res.status).toBe(200);
    const rows = res.status === 200 ? res.body : [];
    expect(rows.find((r) => r.key === 'pricing.freeDeliveryThreshold')).toMatchObject({
      value: 250_000,
      updatedAt: null,
      invalid: false,
    });
    expect(rows.find((r) => r.key === 'shop.managerUsername')?.value).toBe('@lummi_manager');
  });

  it('lets the owner change a value and audits actor, old and new in the same save', async () => {
    const owner = await t.ownerSession();
    const res = await owner.client.admin.settings.update({
      params: { key: 'pricing.freeDeliveryThreshold' },
      body: { value: 300_000 },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body).toMatchObject({ value: 300_000, invalid: false });
    const list = await owner.client.admin.settings.list();
    expect(
      list.status === 200 && list.body.find((r) => r.key === 'pricing.freeDeliveryThreshold'),
    ).toMatchObject({ value: 300_000 });
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, 'setting.changed'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'setting',
      targetId: 'pricing.freeDeliveryThreshold',
      payload: { old: 250_000, new: 300_000 },
    });
  });

  it('refuses a manager on both reads and writes, and changes nothing', async () => {
    const manager = await t.managerSession();
    expect((await manager.client.admin.settings.list()).status).toBe(403);
    const put = await manager.client.admin.settings.update({
      params: { key: 'pricing.freeDeliveryThreshold' },
      body: { value: 1 },
    });
    expect(put.status).toBe(403);
    expect((await manager.client.admin.audit.list({ query: {} })).status).toBe(403);
    expect((await manager.client.admin.audit.filters()).status).toBe(403);
    expect(await t.db.select().from(settings)).toHaveLength(0);
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, 'setting.changed')),
    ).toHaveLength(0);
  });

  it('answers 401 without a session', async () => {
    expect((await t.client.admin.settings.list()).status).toBe(401);
    expect((await t.client.admin.audit.list({ query: {} })).status).toBe(401);
  });

  it('refuses invalid values with issues the panel can word, and writes nothing', async () => {
    const owner = await t.ownerSession();
    const put = (key: string, value: unknown) =>
      owner.client.admin.settings.update({ params: { key }, body: { value } });

    const tooBig = await put('pricing.freeDeliveryThreshold', 200_000_000);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body).toEqual({
      code: 'invalid_value',
      issues: [{ path: [], code: 'too_big', max: 100_000_000, exclusive: false }],
    });
    expect((await put('pricing.freeDeliveryThreshold', 1.5)).body).toMatchObject({
      issues: [{ code: 'not_integer' }],
    });
    expect((await put('pricing.freeDeliveryThreshold', 'many')).status).toBe(400);
    expect((await put('shop.managerUsername', 'lummi_manager')).body).toMatchObject({
      issues: [{ code: 'invalid_format' }],
    });
    expect((await put('pricing.fullSizeVolumesMl', [10])).body).toMatchObject({
      issues: [{ path: ['0'], code: 'too_small', min: 10, exclusive: true }],
    });
    expect((await put('pricing.thresholdBase', { promoCode: 'sideways' })).status).toBe(400);
    expect((await put('no.such.key', 1)).status).toBe(404);
    expect(await t.db.select().from(settings)).toHaveLength(0);
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, 'setting.changed')),
    ).toHaveLength(0);
  });

  it('does not audit a save that changes nothing', async () => {
    const owner = await t.ownerSession();
    const res = await owner.client.admin.settings.update({
      params: { key: 'pricing.freeDeliveryThreshold' },
      body: { value: 250_000 },
    });
    expect(res.status).toBe(200);
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, 'setting.changed')),
    ).toHaveLength(0);
  });

  it('flags a stored value that no longer fits the registry instead of failing the page', async () => {
    const owner = await t.ownerSession();
    await t.db.insert(settings).values({ key: 'auth.sessionTtlSeconds', value: 'oops' });
    const list = await owner.client.admin.settings.list();
    expect(
      list.status === 200 && list.body.find((r) => r.key === 'auth.sessionTtlSeconds'),
    ).toMatchObject({
      value: 3600,
      invalid: true,
    });
  });
});

describe('manager username reaches the Mini App', () => {
  it('defaults to @lummi_manager and follows the setting', async () => {
    const customer = await t.signIn();
    const before = await customer.client.me.get();
    expect(before.status === 200 && before.body.config).toEqual({
      managerUsername: '@lummi_manager',
    });
    const owner = await t.ownerSession();
    await owner.client.admin.settings.update({
      params: { key: 'shop.managerUsername' },
      body: { value: '@lummi_help' },
    });
    const after = await customer.client.me.get();
    expect(after.status === 200 && after.body.config.managerUsername).toBe('@lummi_help');
  });
});

describe('audit log (owner only)', () => {
  const day = (iso: string) => new Date(iso);
  async function seed() {
    const owner = await t.ownerSession();
    const manager = await t.managerSession();
    await t.db.delete(auditLog); // sign-ins are audited too; start from the rows below
    await t.db.insert(auditLog).values([
      // 2026-11-09 23:30 UTC = 2026-11-10 04:30 Tashkent
      {
        actorType: 'staff',
        actorId: owner.staff.id,
        action: 'setting.changed',
        targetType: 'setting',
        targetId: 'a',
        createdAt: day('2026-11-09T23:30:00Z'),
      },
      // 2026-11-10 19:30 UTC = 2026-11-11 00:30 Tashkent
      {
        actorType: 'staff',
        actorId: manager.staff.id,
        action: 'staff.created',
        targetType: 'staff',
        targetId: '2',
        createdAt: day('2026-11-10T19:30:00Z'),
      },
      {
        actorType: 'system',
        action: 'payment.confirmed',
        targetType: 'order',
        targetId: '7',
        createdAt: day('2026-11-12T08:00:00Z'),
      },
      {
        actorType: 'ai',
        action: 'payment.confirmed',
        targetType: 'order',
        targetId: '8',
        createdAt: day('2026-11-13T08:00:00Z'),
      },
    ]);
    return { owner, manager };
  }
  const ids = (res: Awaited<ReturnType<TestApp['client']['admin']['audit']['list']>>) =>
    res.status === 200 ? res.body.items.map((i) => i.targetId) : [];

  it('lists newest first with the actor name, and paginates', async () => {
    const { owner } = await seed();
    const all = await owner.client.admin.audit.list({ query: {} });
    expect(ids(all)).toEqual(['8', '7', '2', 'a']);
    expect(all.status === 200 && all.body.total).toBe(4);
    expect(all.status === 200 && all.body.items[3]).toMatchObject({
      actorName: 'Owner',
      actorType: 'staff',
    });
    const p2 = await owner.client.admin.audit.list({ query: { page: 2, pageSize: 3 } });
    expect(ids(p2)).toEqual(['a']);
    expect(p2.status === 200 && p2.body).toMatchObject({ total: 4, page: 2, pageSize: 3 });
  });

  it('filters by actor, action type and date range', async () => {
    const { owner, manager } = await seed();
    const q = (query: Parameters<typeof owner.client.admin.audit.list>[0]['query']) =>
      owner.client.admin.audit.list({ query }).then(ids);
    expect(await q({ actor: `staff:${manager.staff.id}` })).toEqual(['2']);
    expect(await q({ actor: 'system' })).toEqual(['7']);
    expect(await q({ actor: 'ai' })).toEqual(['8']);
    expect(await q({ actor: 'staff:999' })).toEqual([]);
    expect(await q({ action: 'payment.confirmed' })).toEqual(['8', '7']);
    expect(await q({ action: 'payment.confirmed', actor: 'ai' })).toEqual(['8']);
    // Tashkent days: the 23:30 UTC entry belongs to the 10th, the 19:30 UTC one to the 11th
    expect(await q({ from: '2026-11-10', to: '2026-11-10' })).toEqual(['a']);
    expect(await q({ from: '2026-11-11', to: '2026-11-11' })).toEqual(['2']);
    expect(await q({ from: '2026-11-11', to: '2026-11-12' })).toEqual(['7', '2']);
    expect(await q({ to: '2026-11-10' })).toEqual(['a']);
    expect(await q({ from: '2026-11-13' })).toEqual(['8']);
    expect(await q({ from: '2026-11-14' })).toEqual([]);
  });

  it('rejects a date that is not a calendar day', async () => {
    const owner = await t.ownerSession();
    const res = await fetch(`${t.baseUrl}/admin/audit?from=2026-02-31`, {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(400);
  });

  it('offers the actors and action types that exist', async () => {
    const { owner } = await seed();
    const res = await owner.client.admin.audit.filters();
    expect(res.status).toBe(200);
    const body = res.status === 200 ? res.body : { actions: [], actors: [] };
    expect(body.actions).toEqual(['payment.confirmed', 'setting.changed', 'staff.created']);
    expect(body.actors.map((a) => a.value)).toEqual(
      expect.arrayContaining([`staff:${owner.staff.id}`, 'customer', 'ai', 'system']),
    );
  });
});

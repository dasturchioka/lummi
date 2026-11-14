import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, eq, staff, staffSessions } from '@lummi/db';
import {
  MANAGER_WIDGET_USER,
  OWNER_WIDGET_USER,
  createTestApp,
  type TestApp,
} from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const nowSec = () => Math.floor(t.edges.clock.now().getTime() / 1000);
const login = (payload: Record<string, string | number>) =>
  t.client.admin.loginWidget({ body: payload as never });

describe('POST /admin/auth/telegram (Login Widget)', () => {
  it('signs in an active staff member, sets an httpOnly 7-day cookie and /admin/me accepts it', async () => {
    const owner = await t.ownerSession();
    const res = await login(t.widgetPayload(OWNER_WIDGET_USER));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^lummi_admin=[^;]+/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=604800/);
    expect(setCookie).toMatch(/Path=\//);
    const me = await owner.client.admin.me();
    expect(me.status === 200 && me.body).toMatchObject({
      role: 'owner',
      name: 'Owner',
      active: true,
    });
  });

  it('answers «Нет доступа» (403) to anyone not on staff or not active', async () => {
    const stranger = await login(t.widgetPayload({ id: 555, first_name: 'Eve' }));
    expect(stranger.status).toBe(403);
    expect(stranger.body).toEqual({ code: 'no_access' });
    await t.signInStaff('manager', MANAGER_WIDGET_USER);
    await t.db.update(staff).set({ active: false });
    const inactive = await login(t.widgetPayload(MANAGER_WIDGET_USER));
    expect(inactive.status).toBe(403);
    expect(inactive.headers.get('set-cookie')).toBeNull();
    expect(
      await t.db.select().from(staffSessions).where(eq(staffSessions.staffId, 1)),
    ).toHaveLength(1);
  });

  it('rejects a forged, stale or future-dated payload with 401 and no cookie', async () => {
    await t.ownerSession();
    const forged = { ...t.widgetPayload(OWNER_WIDGET_USER), id: 900002 };
    const stale = t.widgetPayload(OWNER_WIDGET_USER, { authDate: nowSec() - 3600 });
    const future = t.widgetPayload(OWNER_WIDGET_USER, { authDate: nowSec() + 3600 });
    for (const [payload, code] of [
      [forged, 'invalid_login'],
      [stale, 'expired_login'],
      [future, 'expired_login'],
    ] as const) {
      const res = await login(payload);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code });
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });
});

describe('staff session', () => {
  it('rejects a missing, forged or expired cookie', async () => {
    const owner = await t.ownerSession();
    expect((await t.client.admin.me()).status).toBe(401);
    expect(
      (await t.client.admin.me({ extraHeaders: { cookie: 'lummi_admin=nonsense' } })).status,
    ).toBe(401);
    expect((await owner.client.admin.me()).status).toBe(200);
    t.edges.clock.advance(7 * 86_400 * 1000 + 1000);
    expect((await owner.client.admin.me()).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const owner = await t.ownerSession();
    const res = await owner.client.admin.logout();
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toMatch(/lummi_admin=;/);
    // the old cookie value no longer works even though it has not expired
    expect((await owner.client.admin.me()).status).toBe(401);
  });

  it('does not accept the customer Bearer session as a staff session', async () => {
    const customer = await t.signIn();
    const res = await t.client.admin.me({
      extraHeaders: { authorization: `Bearer ${customer.token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('staff management (owner only)', () => {
  it('lists, adds a manager and audits it with the owner as actor', async () => {
    const owner = await t.ownerSession();
    const created = await owner.client.admin.staff.create({
      body: { name: ' Dilnoza ', login: 'dilnoza', password: 'Temp-pass-0001' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      telegramId: null,
      login: 'dilnoza',
      name: 'Dilnoza',
      role: 'manager',
      active: true,
    });
    const list = await owner.client.admin.staff.list();
    expect(list.status === 200 && list.body.map((s) => s.login ?? s.telegramId)).toEqual([
      900001,
      'dilnoza',
    ]);
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, 'staff.created'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'staff',
    });
    const dup = await owner.client.admin.staff.create({
      body: { name: 'Again', login: 'dilnoza', password: 'Temp-pass-0001' },
    });
    expect(dup.status).toBe(409);
  });

  it('a new manager can sign in right away', async () => {
    const owner = await t.ownerSession();
    await owner.client.admin.staff.create({
      body: { name: 'Dilnoza', login: 'dilnoza', password: 'Temp-pass-0001' },
    });
    const res = await t.client.admin.passwordLogin({
      body: { login: 'dilnoza', password: 'Temp-pass-0001' },
    });
    expect(res.status).toBe(200);
  });

  it('deactivating revokes every session of that manager at once; reactivating allows sign-in again', async () => {
    const owner = await t.ownerSession();
    const manager = await t.managerSession();
    const second = await login(t.widgetPayload(MANAGER_WIDGET_USER));
    expect(second.status).toBe(200);
    expect((await manager.client.admin.me()).status).toBe(200);

    const res = await owner.client.admin.staff.update({
      params: { id: manager.staff.id },
      body: { active: false },
    });
    expect(res.status === 200 && res.body.active).toBe(false);
    expect((await manager.client.admin.me()).status).toBe(401);
    const revoked = await t.db
      .select()
      .from(staffSessions)
      .where(eq(staffSessions.staffId, manager.staff.id));
    expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);
    expect((await login(t.widgetPayload(MANAGER_WIDGET_USER))).status).toBe(403);

    await owner.client.admin.staff.update({
      params: { id: manager.staff.id },
      body: { active: true },
    });
    expect((await login(t.widgetPayload(MANAGER_WIDGET_USER))).status).toBe(200);
    const actions = (await t.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain('staff.deactivated');
    expect(actions).toContain('staff.activated');
  });

  it('removing deletes the manager, ends the session and keeps the name in the audit entry', async () => {
    const owner = await t.ownerSession();
    const manager = await t.managerSession();
    const res = await owner.client.admin.staff.remove({ params: { id: manager.staff.id } });
    expect(res.status).toBe(200);
    expect((await manager.client.admin.me()).status).toBe(401);
    expect(await t.db.select().from(staff).where(eq(staff.id, manager.staff.id))).toHaveLength(0);
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'staff.removed'));
    expect(entry).toMatchObject({ actorType: 'staff', actorId: owner.staff.id });
    expect(entry?.payload).toMatchObject({ name: 'Manager', telegramId: 900002 });
    expect(
      (await owner.client.admin.staff.remove({ params: { id: manager.staff.id } })).status,
    ).toBe(404);
  });

  it('never lets the panel touch an owner (including yourself)', async () => {
    const owner = await t.ownerSession();
    const self = { params: { id: owner.staff.id } };
    expect(
      (await owner.client.admin.staff.update({ ...self, body: { active: false } })).status,
    ).toBe(409);
    expect((await owner.client.admin.staff.remove({ ...self })).status).toBe(409);
    expect((await owner.client.admin.me()).status).toBe(200);
  });

  it('the owner-only guard answers a manager 403 on every staff endpoint, and anonymous 401', async () => {
    const manager = await t.managerSession();
    const c = manager.client.admin.staff;
    const results = await Promise.all([
      c.list(),
      c.create({ body: { name: 'x', login: 'xxx', password: 'Temp-pass-0001' } }),
      c.update({ params: { id: 1 }, body: { active: false } }),
      c.remove({ params: { id: 1 } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(results[0]?.body).toEqual({ code: 'forbidden' });
    const anon = await t.client.admin.staff.list();
    expect(anon.status).toBe(401);
    expect(await t.db.select().from(staff)).toHaveLength(1);
  });
});

describe('POST /admin/auth/dev (dev-only sign-in)', () => {
  it('signs in an active staff member when enabled, and still says «Нет доступа» to others', async () => {
    const owner = await t.ownerSession();
    const ok = await t.client.admin.devLogin({ body: { telegramId: owner.staff.telegramId! } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie') ?? '').toMatch(/^lummi_admin=/);
    expect((await t.client.admin.devLogin({ body: { telegramId: 31337 } })).status).toBe(403);
  });
});

describe('dev-only sign-in switched off', () => {
  it('answers 404 when ADMIN_DEV_LOGIN is not enabled', async () => {
    const off = await createTestApp({ ADMIN_DEV_LOGIN: 'false' });
    try {
      const res = await off.client.admin.devLogin({ body: { telegramId: 1 } });
      expect(res.status).toBe(404);
    } finally {
      await off.close();
    }
  });
});

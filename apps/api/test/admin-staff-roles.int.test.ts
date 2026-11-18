import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, eq, staff } from '@lummi/db';
import { StaffService } from '../src/staff/staff.service';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const TEMP = 'Temp-pass-0001';
const FINAL = 'Final-pass-0002';

async function add(owner: StaffSession, login: string, role?: 'owner' | 'manager') {
  const res = await owner.client.admin.staff.create({
    body: { name: login, login, password: TEMP, ...(role ? { role } : {}) },
  });
  if (res.status !== 201) throw new Error(`could not add ${login}: ${res.status}`);
  return res.body;
}

/** Signs in as a member added by the owner and gets past the forced password change. */
async function signedIn(login: string) {
  const res = await t.client.admin.passwordLogin({ body: { login, password: TEMP } });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  const client = t.withCookie((res.headers.get('set-cookie') ?? '').split(';')[0] ?? '');
  const changed = await client.admin.changePassword({ body: { newPassword: FINAL } });
  if (changed.status !== 200) throw new Error(`password change failed: ${changed.status}`);
  return client;
}

describe('staff roles (#64)', () => {
  it('adds a member as a manager by default, or as an owner when asked; both audited with the role', async () => {
    const owner = await t.ownerSession();
    const manager = await add(owner, 'dilnoza');
    const second = await add(owner, 'jasur', 'owner');
    expect(manager.role).toBe('manager');
    expect(second.role).toBe('owner');
    const created = await t.db.select().from(auditLog).where(eq(auditLog.action, 'staff.created'));
    expect(created.map((a) => (a.payload as { role: string }).role)).toEqual(['manager', 'owner']);
  });

  it('an owner changes a role, audited with the old and the new one', async () => {
    const owner = await t.ownerSession();
    const member = await add(owner, 'dilnoza');
    const res = await owner.client.admin.staff.setRole({
      params: { id: member.id },
      body: { role: 'owner' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: member.id, role: 'owner' });
    const audit = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'staff.role_changed'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: owner.staff.id,
      targetType: 'staff',
      targetId: String(member.id),
      payload: { name: 'dilnoza', from: 'manager', to: 'owner' },
    });
    // the same role again changes nothing and leaves no second entry
    await owner.client.admin.staff.setRole({ params: { id: member.id }, body: { role: 'owner' } });
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, 'staff.role_changed')),
    ).toHaveLength(1);
  });

  it('refuses to change your own role, and an unknown member is 404', async () => {
    const owner = await t.ownerSession();
    await add(owner, 'jasur', 'owner');
    const own = await owner.client.admin.staff.setRole({
      params: { id: owner.staff.id },
      body: { role: 'manager' },
    });
    expect(own.status).toBe(409);
    expect(own.body).toEqual({ code: 'own_role' });
    const missing = await owner.client.admin.staff.setRole({
      params: { id: 9999 },
      body: { role: 'owner' },
    });
    expect(missing.status).toBe(404);
    const [row] = await t.db.select().from(staff).where(eq(staff.id, owner.staff.id));
    expect(row?.role).toBe('owner');
  });

  it('refuses a demotion that would leave no active owner', async () => {
    const owner = await t.ownerSession();
    const other = await add(owner, 'jasur', 'owner');
    // the other owner is switched off, so the signed-in owner is the only active one; a second
    // actor row (inactive by now, as after a concurrent switch-off) tries to demote them
    await t.db.update(staff).set({ active: false }).where(eq(staff.id, other.id));
    const service = t.app.get(StaffService);
    const stale = { ...(other as unknown as typeof owner.staff), active: false };
    const res = await service.setRole(stale, owner.staff.id, 'manager');
    expect(res).toEqual({ ok: false, reason: 'last_owner' });
    const [row] = await t.db.select().from(staff).where(eq(staff.id, owner.staff.id));
    expect(row?.role).toBe('owner');
  });

  it('a demotion needs another active owner: with one, it goes through', async () => {
    const owner = await t.ownerSession();
    await add(owner, 'jasur', 'owner');
    const otherClient = await signedIn('jasur');
    const res = await otherClient.admin.staff.setRole({
      params: { id: owner.staff.id },
      body: { role: 'manager' },
    });
    expect(res.status).toBe(200);
    const [now] = await t.db.select().from(staff).where(eq(staff.id, owner.staff.id));
    expect(now?.role).toBe('manager');
  });

  it('two owners demoting each other at once: exactly one succeeds, the other is refused', async () => {
    const owner = await t.ownerSession();
    const other = await add(owner, 'jasur', 'owner');
    const otherClient = await signedIn('jasur');
    const [a, b] = await Promise.all([
      owner.client.admin.staff.setRole({ params: { id: other.id }, body: { role: 'manager' } }),
      otherClient.admin.staff.setRole({
        params: { id: owner.staff.id },
        body: { role: 'manager' },
      }),
    ]);
    // the loser is refused either inside the lock (409 last_owner) or, when the winner had already
    // committed, at the guard (403): which one depends on timing, never on both succeeding
    expect([a.status, b.status].filter((x) => x === 200)).toHaveLength(1);
    const refused = a.status === 200 ? b : a;
    expect([403, 409]).toContain(refused.status);
    if (refused.status === 409) expect(refused.body).toEqual({ code: 'last_owner' });
    const rows = await t.db.select().from(staff);
    expect(rows.filter((r) => r.role === 'owner' && r.active)).toHaveLength(1);
  });

  it('an owner demoted a moment ago cannot change roles: the actor is re-checked inside the lock', async () => {
    const owner = await t.ownerSession();
    const other = await add(owner, 'jasur', 'owner');
    const manager = await add(owner, 'dilnoza');
    await t.db.update(staff).set({ role: 'manager' }).where(eq(staff.id, other.id));
    const stale = { ...(other as unknown as typeof owner.staff), role: 'owner' as const };
    const res = await t.app.get(StaffService).setRole(stale, manager.id, 'owner');
    expect(res).toEqual({ ok: false, reason: 'conflict' });
    const [row] = await t.db.select().from(staff).where(eq(staff.id, manager.id));
    expect(row?.role).toBe('manager');
  });

  it('refuses to promote a switched-off member', async () => {
    const owner = await t.ownerSession();
    const member = await add(owner, 'dilnoza');
    await owner.client.admin.staff.update({ params: { id: member.id }, body: { active: false } });
    const res = await owner.client.admin.staff.setRole({
      params: { id: member.id },
      body: { role: 'owner' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: 'inactive' });
    const [row] = await t.db.select().from(staff).where(eq(staff.id, member.id));
    expect(row?.role).toBe('manager');
  });

  it("a manager's open session loses owner routes when demoted and gets them back when promoted", async () => {
    const owner = await t.ownerSession();
    const member = await add(owner, 'jasur', 'owner');
    const client = await signedIn('jasur');
    expect((await client.admin.staff.list()).status).toBe(200);

    await owner.client.admin.staff.setRole({
      params: { id: member.id },
      body: { role: 'manager' },
    });
    expect((await client.admin.staff.list()).status).toBe(403);
    expect((await client.admin.me()).status).toBe(200);

    await owner.client.admin.staff.setRole({ params: { id: member.id }, body: { role: 'owner' } });
    expect((await client.admin.staff.list()).status).toBe(200);
  });

  it('a manager cannot change roles', async () => {
    const owner = await t.ownerSession();
    const member = await add(owner, 'dilnoza');
    const client = await signedIn('dilnoza');
    const res = await client.admin.staff.setRole({
      params: { id: member.id },
      body: { role: 'owner' },
    });
    expect(res.status).toBe(403);
  });
});

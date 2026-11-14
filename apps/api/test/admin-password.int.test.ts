import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, eq, staff } from '@lummi/db';
import { argon2Derivations } from '../src/staff/password';
import { captureLogs } from './harness/logs';
import {
  MANAGER_WIDGET_USER,
  createTestApp,
  type StaffSession,
  type TestApp,
} from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const TEMP = 'Temp-pass-0001';
const FINAL = 'Final-pass-0002';
const RESET = 'Reset-pass-0003';
const HOME_IP = '203.0.113.7';

type Client = StaffSession['client'];

const signIn = (login: string, password: string, ip = HOME_IP) =>
  t.client.admin.passwordLogin({ body: { login, password }, extraHeaders: { 'x-real-ip': ip } });
const cookieOf = (res: { headers: Headers }) =>
  (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

/** Signs in and returns a client bound to the new session (throws unless 200). */
async function session(login: string, password: string): Promise<Client> {
  const res = await signIn(login, password);
  if (res.status !== 200) throw new Error(`sign-in as ${login} failed: ${res.status}`);
  return t.withCookie(cookieOf(res));
}

async function addManager(owner: StaffSession, login = 'dilnoza', name = 'Dilnoza') {
  const res = await owner.client.admin.staff.create({ body: { name, login, password: TEMP } });
  if (res.status !== 201) throw new Error(`could not add ${login}: ${res.status}`);
  return res.body;
}

/** A manager past the forced change: signs in with FINAL from now on. */
async function readyManager(owner: StaffSession, login = 'dilnoza') {
  const added = await addManager(owner, login);
  const client = await session(login, TEMP);
  const changed = await client.admin.changePassword({ body: { newPassword: FINAL } });
  if (changed.status !== 200) throw new Error(`forced change failed: ${changed.status}`);
  return { id: added.id, client };
}

async function setSettings(owner: StaffSession, values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) {
    const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
    if (res.status !== 200) throw new Error(`setting ${key}: ${res.status}`);
  }
}

/** A request outside the contract's declared answers (a 403 the orders list never declares). */
const rawGet = (path: string, cookie: string) =>
  fetch(`${t.baseUrl}${path}`, { headers: { cookie } });

const audits = async (action: string) =>
  t.db.select().from(auditLog).where(eq(auditLog.action, action));

describe('sign-in with login and password', () => {
  it('the owner adds a manager with a temporary password; the manager signs in with it, in any letter case, and must change it before anything else', async () => {
    const owner = await t.ownerSession();
    const created = await owner.client.admin.staff.create({
      body: { name: ' Dilnoza ', login: 'Dilnoza', password: TEMP },
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(Number),
      name: 'Dilnoza',
      login: 'dilnoza',
      telegramId: null,
      hasPassword: true,
      mustChangePassword: true,
      role: 'manager',
      active: true,
    });

    const res = await signIn('DILNOZA', TEMP);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ login: 'dilnoza', mustChangePassword: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^lummi_admin=[^;]+/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = cookieOf(res);
    const manager = t.withCookie(cookie);

    // only the forced change, who-am-I, the policy and sign-out work until then
    expect((await rawGet('/admin/orders', cookie)).status).toBe(403);
    expect(await (await rawGet('/admin/orders', cookie)).json()).toEqual({
      code: 'password_change_required',
    });
    expect((await manager.admin.me()).body).toMatchObject({ mustChangePassword: true });
    expect((await manager.admin.passwordPolicy()).body).toEqual({ minLength: 8 });

    const changed = await manager.admin.changePassword({ body: { newPassword: FINAL } });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ mustChangePassword: false, hasPassword: true });
    expect((await rawGet('/admin/orders', cookie)).status).toBe(200);

    expect((await signIn('dilnoza', TEMP)).status).toBe(401);
    expect((await signIn('dilnoza', FINAL)).status).toBe(200);

    const [entry] = await audits('staff.created');
    expect(entry).toMatchObject({ actorType: 'staff', actorId: owner.staff.id });
    expect(entry?.payload).toEqual({ name: 'Dilnoza', login: 'dilnoza', role: 'manager' });
    const [change] = await audits('staff.password_changed');
    expect(change).toMatchObject({
      actorType: 'staff',
      actorId: created.status === 201 ? created.body.id : -1,
      targetId: String(created.status === 201 ? created.body.id : -1),
    });
    const signedIn = await audits('staff.signed_in');
    expect(signedIn.map((a) => a.payload)).toContainEqual({ method: 'password' });
  });

  it('a wrong password, an unknown login and a login that cannot exist all get the same 401 and no cookie', async () => {
    const owner = await t.ownerSession();
    await addManager(owner);
    for (const [login, password] of [
      ['dilnoza', 'wrong-password'],
      ['nobody', TEMP],
      ['x', TEMP],
      ['дильноза', TEMP],
    ] as const) {
      const res = await signIn(login, password);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 'invalid_credentials' });
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('a switched-off manager with the right password gets «Нет доступа» and no session', async () => {
    const owner = await t.ownerSession();
    const added = await addManager(owner);
    await owner.client.admin.staff.update({ params: { id: added.id }, body: { active: false } });
    const res = await signIn('dilnoza', TEMP);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: 'no_access' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('locks a login after the set number of failures, says until when, and opens again when the lock ends', async () => {
    const owner = await t.ownerSession();
    const added = await addManager(owner);
    await setSettings(owner, {
      'auth.passwordAttemptsPerLogin': 3,
      'auth.passwordAttemptWindowSeconds': 600,
      'auth.passwordLockSeconds': 300,
    });
    const start = t.edges.clock.now().getTime();
    const retryAt = new Date(start + 300_000).toISOString();

    expect((await signIn('dilnoza', 'wrong-1')).status).toBe(401);
    expect((await signIn('dilnoza', 'wrong-2')).status).toBe(401);
    const third = await signIn('dilnoza', 'wrong-3');
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ code: 'locked', retryAt });
    // the right password, from anywhere, waits too
    expect((await signIn('dilnoza', TEMP)).body).toEqual({ code: 'locked', retryAt });
    expect((await signIn('Dilnoza', TEMP, '198.51.100.9')).status).toBe(429);

    const [lock] = await audits('staff.locked');
    expect(lock).toMatchObject({
      actorType: 'system',
      targetType: 'staff',
      targetId: String(added.id),
    });
    expect(lock?.payload).toEqual({ until: retryAt, by: 'login' });

    t.edges.clock.advance(299_000);
    expect((await signIn('dilnoza', TEMP)).status).toBe(429);
    t.edges.clock.advance(1_000);
    expect((await signIn('dilnoza', TEMP)).status).toBe(200);
    // a success starts the count again
    expect((await signIn('dilnoza', 'wrong-4')).status).toBe(401);
    expect((await signIn('dilnoza', 'wrong-5')).status).toBe(401);
    expect((await signIn('dilnoza', TEMP)).status).toBe(200);
  });

  it('by default, the fifth failure in 15 minutes locks the login for 15 minutes', async () => {
    const owner = await t.ownerSession();
    await addManager(owner);
    for (let i = 1; i <= 4; i++) expect((await signIn('dilnoza', `wrong-${i}`)).status).toBe(401);
    const fifth = await signIn('dilnoza', 'wrong-5');
    expect(fifth.body).toEqual({
      code: 'locked',
      retryAt: new Date(t.edges.clock.now().getTime() + 900_000).toISOString(),
    });
  });

  it('counts each attempt before checking it: of ten parallel guesses, no more than the limit reach argon2', async () => {
    const owner = await t.ownerSession();
    await addManager(owner);
    const limit = 5; // `auth.passwordAttemptsPerLogin` by default
    const before = argon2Derivations();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => signIn('dilnoza', `wrong-${i}`)),
    );
    const checked = argon2Derivations() - before;
    const wrong = results.filter((r) => r.status === 401).length;
    const locked = results.filter((r) => r.status === 429);
    expect(checked).toBeLessThanOrEqual(limit);
    expect(wrong).toBeLessThanOrEqual(limit);
    expect(wrong + locked.length).toBe(10);
    expect(locked.length).toBeGreaterThanOrEqual(10 - limit);
    for (const r of locked) expect(r.body).toMatchObject({ code: 'locked' });
    // the lock holds for the right password too, without checking it
    const derivationsNow = argon2Derivations();
    expect((await signIn('dilnoza', TEMP)).status).toBe(429);
    expect(argon2Derivations()).toBe(derivationsNow);
    expect(await audits('staff.locked')).toHaveLength(1);
  });

  it('failures older than the window no longer count', async () => {
    const owner = await t.ownerSession();
    await addManager(owner);
    await setSettings(owner, {
      'auth.passwordAttemptsPerLogin': 3,
      'auth.passwordAttemptWindowSeconds': 600,
    });
    expect((await signIn('dilnoza', 'wrong-1')).status).toBe(401);
    expect((await signIn('dilnoza', 'wrong-2')).status).toBe(401);
    t.edges.clock.advance(601_000);
    expect((await signIn('dilnoza', 'wrong-3')).status).toBe(401);
    expect((await signIn('dilnoza', 'wrong-4')).status).toBe(401);
    expect((await signIn('dilnoza', 'wrong-5')).status).toBe(429);
  });

  it('locks an address after the set number of failures over any logins; other addresses still sign in', async () => {
    const owner = await t.ownerSession();
    await addManager(owner);
    await setSettings(owner, {
      'auth.passwordAttemptsPerIp': 4,
      'auth.passwordLockSeconds': 300,
    });
    for (const login of ['a1x', 'a2x', 'a3x']) {
      expect((await signIn(login, 'wrong')).status).toBe(401);
    }
    expect((await signIn('a4x', 'wrong')).status).toBe(429);
    expect((await signIn('dilnoza', TEMP)).status).toBe(429);
    expect((await signIn('dilnoza', TEMP, '198.51.100.9')).status).toBe(200);
    const [lock] = await audits('auth.address_locked');
    expect(lock).toMatchObject({ actorType: 'system', targetType: 'ip', targetId: HOME_IP });
  });
});

describe('password changes and resets end sessions', () => {
  it('the owner’s reset sets a new temporary password and ends every session of that manager', async () => {
    const owner = await t.ownerSession();
    const { id, client: first } = await readyManager(owner);
    const second = await session('dilnoza', FINAL);

    const res = await owner.client.admin.staff.resetPassword({
      params: { id },
      body: { password: RESET },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, mustChangePassword: true, hasPassword: true });
    expect((await first.admin.me()).status).toBe(401);
    expect((await second.admin.me()).status).toBe(401);
    expect((await signIn('dilnoza', FINAL)).status).toBe(401);
    const again = await signIn('dilnoza', RESET);
    expect(again.status === 200 && again.body.mustChangePassword).toBe(true);

    const [entry] = await audits('staff.password_reset');
    expect(entry).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetId: String(id),
    });
    expect(entry?.payload).toEqual({ name: 'Dilnoza', login: 'dilnoza' });
  });

  it('a password change ends the member’s other sessions and keeps this one', async () => {
    const owner = await t.ownerSession();
    const { client: here } = await readyManager(owner);
    const elsewhere = await session('dilnoza', FINAL);
    const res = await here.admin.changePassword({
      body: { currentPassword: FINAL, newPassword: 'Another-pass-0004' },
    });
    expect(res.status).toBe(200);
    expect((await here.admin.me()).status).toBe(200);
    expect((await elsewhere.admin.me()).status).toBe(401);
    expect((await signIn('dilnoza', 'Another-pass-0004')).status).toBe(200);
  });

  it('a change needs the current password unless it is temporary; the new one must be long enough and new', async () => {
    const owner = await t.ownerSession();
    await addManager(owner);
    const forced = await session('dilnoza', TEMP);
    const sameTemp = await forced.admin.changePassword({ body: { newPassword: TEMP } });
    expect(sameTemp).toMatchObject({ status: 422, body: { code: 'same_password' } });
    await forced.admin.changePassword({ body: { newPassword: FINAL } });

    const change = (body: { currentPassword?: string; newPassword: string }) =>
      forced.admin.changePassword({ body });
    expect(await change({ newPassword: 'New-pass-0005' })).toMatchObject({
      status: 422,
      body: { code: 'wrong_password' },
    });
    expect(await change({ currentPassword: 'nope', newPassword: 'New-pass-0005' })).toMatchObject({
      status: 422,
      body: { code: 'wrong_password' },
    });
    expect(await change({ currentPassword: FINAL, newPassword: FINAL })).toMatchObject({
      status: 422,
      body: { code: 'same_password' },
    });
    expect(await change({ currentPassword: FINAL, newPassword: 'short7!' })).toMatchObject({
      status: 422,
      body: { code: 'weak_password', minLength: 8 },
    });
    await setSettings(owner, { 'auth.passwordMinLength': 12 });
    expect(await change({ currentPassword: FINAL, newPassword: 'elevenchars' })).toMatchObject({
      status: 422,
      body: { code: 'weak_password', minLength: 12 },
    });
    expect(
      await owner.client.admin.staff.create({
        body: { name: 'Bekzod', login: 'bekzod', password: 'elevenchars' },
      }),
    ).toMatchObject({ status: 422, body: { code: 'weak_password', minLength: 12 } });
    expect((await change({ currentPassword: FINAL, newPassword: 'twelve-chars' })).status).toBe(
      200,
    );
  });

  it('logins are unique whatever the letter case', async () => {
    const owner = await t.ownerSession();
    await addManager(owner);
    const dup = await owner.client.admin.staff.create({
      body: { name: 'Other', login: 'DilNoza', password: TEMP },
    });
    expect(dup).toMatchObject({ status: 409, body: { code: 'login_taken' } });
  });

  it('a manager added by Telegram id before logins gets a login with their first reset, and the widget still works', async () => {
    const owner = await t.ownerSession();
    const legacy = await t.managerSession();
    const list = await owner.client.admin.staff.list();
    expect(list.status === 200 && list.body.find((s) => s.id === legacy.staff.id)).toMatchObject({
      login: null,
      hasPassword: false,
      mustChangePassword: false,
      telegramId: MANAGER_WIDGET_USER.id,
    });
    const reset = (body: { password: string; login?: string }) =>
      owner.client.admin.staff.resetPassword({ params: { id: legacy.staff.id }, body });
    expect(await reset({ password: RESET })).toMatchObject({
      status: 409,
      body: { code: 'login_required' },
    });
    await addManager(owner, 'dilnoza');
    expect(await reset({ password: RESET, login: 'Dilnoza' })).toMatchObject({
      status: 409,
      body: { code: 'login_taken' },
    });
    expect(await reset({ password: RESET, login: 'Manager.1' })).toMatchObject({
      status: 200,
      body: { login: 'manager.1', hasPassword: true, mustChangePassword: true },
    });
    // the reset ended the Telegram session too; the widget signs in again, into the forced change
    expect((await legacy.client.admin.me()).status).toBe(401);
    const widget = await t.client.admin.loginWidget({
      body: t.widgetPayload(MANAGER_WIDGET_USER) as never,
    });
    expect(widget.status === 200 && widget.body.mustChangePassword).toBe(true);
    expect((await signIn('manager.1', RESET)).status).toBe(200);
  });

  it('the panel never resets an owner, and a manager resets nobody', async () => {
    const owner = await t.ownerSession();
    const { id, client: manager } = await readyManager(owner);
    expect(
      await owner.client.admin.staff.resetPassword({
        params: { id: owner.staff.id },
        body: { password: RESET, login: 'owner' },
      }),
    ).toMatchObject({ status: 409, body: { code: 'conflict' } });
    expect(
      (await manager.admin.staff.resetPassword({ params: { id }, body: { password: RESET } }))
        .status,
    ).toBe(403);
    expect(
      (
        await owner.client.admin.staff.resetPassword({
          params: { id: 999 },
          body: { password: RESET },
        })
      ).status,
    ).toBe(404);
  });
});

describe('a password never leaves the API', () => {
  it('no response body and no log line carries a password or its hash', async () => {
    const bodies: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await realFetch(...args);
      bodies.push(await res.clone().text());
      return res;
    };
    const logs = captureLogs();
    try {
      const owner = await t.ownerSession();
      const { id, client } = await readyManager(owner);
      await signIn('dilnoza', 'Wrong-pass-0009');
      await signIn('nobody', FINAL);
      await client.admin.changePassword({
        body: { currentPassword: 'Wrong-pass-0009', newPassword: 'Another-pass-0004' },
      });
      await client.admin.changePassword({ body: { currentPassword: FINAL, newPassword: 'short' } });
      await owner.client.admin.staff.resetPassword({ params: { id }, body: { password: RESET } });
      await owner.client.admin.staff.list();
      await owner.client.admin.me();
      // malformed bodies: the validation error must not echo the value either
      await realFetch(`${t.baseUrl}/admin/auth/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: 'dilnoza', password: 'x'.repeat(129) }),
      }).then(async (r) => bodies.push(String(r.status), await r.text()));
      await realFetch(`${t.baseUrl}/admin/staff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ name: 'X', login: 'no', password: 'Leaky-pass-0010' }),
      }).then(async (r) => bodies.push(String(r.status), await r.text()));
    } finally {
      globalThis.fetch = realFetch;
      logs.stop();
    }
    expect(bodies.length).toBeGreaterThan(10);
    expect(bodies).toContain('400');
    const all = [...bodies, ...logs.entries.map((e) => e.text)].join('\n');
    for (const secret of [
      TEMP,
      FINAL,
      RESET,
      'Wrong-pass-0009',
      'Leaky-pass-0010',
      'x'.repeat(129),
    ]) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toContain('$argon2');
    const stored = await t.db.select({ hash: staff.passwordHash }).from(staff);
    expect(stored.some((r) => r.hash?.startsWith('$argon2id$'))).toBe(true);
  });
});

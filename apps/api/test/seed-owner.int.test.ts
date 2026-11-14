import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, eq, staff } from '@lummi/db';
import { parseSeedOwnerArgs, parseSetOwnerPasswordArgs } from '../src/cli/seed-owner-args';
import { seedOwner, setOwnerPassword } from '../src/staff/seed-owner';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const now = () => t.edges.clock.now();
const signIn = (login: string, password: string) =>
  t.client.admin.passwordLogin({ body: { login, password } });

describe('seed owner CLI', () => {
  it('parses arguments and rejects bad ones', () => {
    expect(parseSeedOwnerArgs(['--telegram-id', '42', '--name', ' Ali '])).toEqual({
      telegramId: 42,
      name: 'Ali',
    });
    expect(parseSeedOwnerArgs(['--login', ' Fayzali ', '--name', 'Fayzali'])).toEqual({
      login: 'fayzali',
      name: 'Fayzali',
    });
    expect(parseSeedOwnerArgs(['--login', 'f.j', '--telegram-id', '7', '--name', 'F'])).toEqual({
      login: 'f.j',
      telegramId: 7,
      name: 'F',
    });
    expect(() => parseSeedOwnerArgs(['--telegram-id', 'x', '--name', 'A'])).toThrow(/Usage/);
    expect(() => parseSeedOwnerArgs(['--telegram-id', '42'])).toThrow(/Usage/);
    expect(() => parseSeedOwnerArgs(['--name', 'A'])).toThrow(/Usage/);
    expect(() => parseSeedOwnerArgs(['--login', 'ab', '--name', 'A'])).toThrow(/Usage/);
    expect(parseSetOwnerPasswordArgs(['--login', 'Fayzali'])).toEqual({ login: 'fayzali' });
    expect(() => parseSetOwnerPasswordArgs([])).toThrow(/Usage/);
  });

  it('creates the first owner who can sign in, and is idempotent (reactivates, never duplicates)', async () => {
    const first = await seedOwner(t.db, now(), { telegramId: 900001, name: 'Owner' });
    expect(first).toMatchObject({ role: 'owner', active: true });
    expect(
      (
        await t.client.admin.loginWidget({
          body: t.widgetPayload({ id: 900001, first_name: 'Owner' }) as never,
        })
      ).status,
    ).toBe(200);

    await t.db.update(staff).set({ active: false });
    const again = await seedOwner(t.db, now(), { telegramId: 900001, name: 'Owner' });
    expect(again.id).toBe(first.id);
    expect(again.active).toBe(true);
    expect(await t.db.select().from(staff)).toHaveLength(1);
    const actions = (await t.db.select().from(auditLog)).map((a) => [a.action, a.actorType]);
    expect(actions).toContainEqual(['staff.owner_seeded', 'system']);
    expect(actions).toContainEqual(['staff.owner_updated', 'system']);
  });

  it('gives an owner a login, then a temporary password that must be changed at the first sign-in', async () => {
    const tg = await seedOwner(t.db, now(), { telegramId: 900001, name: 'Owner' });
    const withLogin = await seedOwner(t.db, now(), {
      telegramId: 900001,
      login: 'fayzali',
      name: 'Fayzali',
    });
    expect(withLogin).toMatchObject({ id: tg.id, login: 'fayzali', telegramId: 900001 });
    expect(withLogin.passwordHash).toBeNull();
    // no password yet: nothing to sign in with
    expect((await signIn('fayzali', 'anything-at-all')).status).toBe(401);

    const { password } = await setOwnerPassword(t.db, now(), 'fayzali');
    expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{16}$/);
    const res = await signIn('fayzali', password);
    expect(res.status === 200 && res.body).toMatchObject({
      role: 'owner',
      mustChangePassword: true,
    });
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'staff.password_reset'));
    expect(entry).toMatchObject({ actorType: 'system', targetId: String(tg.id) });
    expect(JSON.stringify(entry?.payload)).not.toContain(password);
  });

  it('a lost password: a new temporary one ends every session the owner had', async () => {
    await seedOwner(t.db, now(), { login: 'fayzali', name: 'Fayzali' });
    const first = await setOwnerPassword(t.db, now(), 'fayzali');
    const res = await signIn('fayzali', first.password);
    const owner = t.withCookie((res.headers.get('set-cookie') ?? '').split(';')[0] ?? '');
    await owner.admin.changePassword({ body: { newPassword: 'Forgotten-0001' } });
    expect((await owner.admin.me()).status).toBe(200);

    const second = await setOwnerPassword(t.db, now(), 'fayzali');
    expect(second.password).not.toBe(first.password);
    expect((await owner.admin.me()).status).toBe(401);
    expect((await signIn('fayzali', 'Forgotten-0001')).status).toBe(401);
    expect((await signIn('fayzali', second.password)).status).toBe(200);
  });

  it('refuses a login that is not an owner’s, and a Telegram id and login of two records', async () => {
    await expect(setOwnerPassword(t.db, now(), 'nobody')).rejects.toThrow(/No owner/);
    await seedOwner(t.db, now(), { telegramId: 900001, name: 'Owner' });
    await seedOwner(t.db, now(), { login: 'second', name: 'Second' });
    await expect(
      seedOwner(t.db, now(), { telegramId: 900001, login: 'second', name: 'X' }),
    ).rejects.toThrow(/two different staff records/);
    const owner = await t.ownerSession();
    const created = await owner.client.admin.staff.create({
      body: { name: 'M', login: 'manager', password: 'Temp-pass-0001' },
    });
    expect(created.status).toBe(201);
    await expect(setOwnerPassword(t.db, now(), 'manager')).rejects.toThrow(/No owner/);
  });
});

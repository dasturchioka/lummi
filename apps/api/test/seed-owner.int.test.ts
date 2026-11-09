import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, staff } from '@lummi/db';
import { parseSeedOwnerArgs } from '../src/cli/seed-owner-args';
import { StaffService } from '../src/staff/staff.service';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe('seed owner CLI', () => {
  it('parses arguments and rejects bad ones', () => {
    expect(parseSeedOwnerArgs(['--telegram-id', '42', '--name', ' Ali '])).toEqual({
      telegramId: 42,
      name: 'Ali',
    });
    expect(() => parseSeedOwnerArgs(['--telegram-id', 'x', '--name', 'A'])).toThrow(/Usage/);
    expect(() => parseSeedOwnerArgs(['--telegram-id', '42'])).toThrow(/Usage/);
  });

  it('creates the first owner who can sign in, and is idempotent (reactivates, never duplicates)', async () => {
    const svc = new StaffService(t.db, t.edges, new AuditService(), undefined as never);
    const first = await svc.seedOwner({ telegramId: 900001, name: 'Owner' });
    expect(first).toMatchObject({ role: 'owner', active: true });
    expect(
      (
        await t.client.admin.loginWidget({
          body: t.widgetPayload({ id: 900001, first_name: 'Owner' }) as never,
        })
      ).status,
    ).toBe(200);

    await t.db.update(staff).set({ active: false });
    const again = await svc.seedOwner({ telegramId: 900001, name: 'Owner' });
    expect(again.id).toBe(first.id);
    expect(again.active).toBe(true);
    expect(await t.db.select().from(staff)).toHaveLength(1);
    const actions = (await t.db.select().from(auditLog)).map((a) => [a.action, a.actorType]);
    expect(actions).toContainEqual(['staff.owner_seeded', 'system']);
    expect(actions).toContainEqual(['staff.owner_updated', 'system']);
  });
});

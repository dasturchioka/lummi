import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, settings } from '@lummi/db';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
let svc: SettingsService;
beforeAll(async () => {
  t = await createTestApp();
  svc = new SettingsService(t.db, new AuditService());
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe('SettingsService', () => {
  it('returns the default when nothing is stored', async () => {
    expect(await svc.get('auth.initDataMaxAgeSeconds')).toBe(300);
  });

  it('set stores a typed value and audits actor, old and new', async () => {
    await svc.set('auth.sessionTtlSeconds', 7200, { type: 'staff', id: 5 });
    expect(await svc.get('auth.sessionTtlSeconds')).toBe(7200);
    await svc.set('auth.sessionTtlSeconds', 600, { type: 'staff', id: 5 });
    const rows = await t.db.select().from(auditLog);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      actorType: 'staff',
      actorId: 5,
      action: 'setting.changed',
      targetType: 'setting',
      targetId: 'auth.sessionTtlSeconds',
      payload: { old: 7200, new: 600 },
    });
    expect(rows[1]!.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a value that fails the schema and writes nothing', async () => {
    await expect(svc.set('auth.sessionTtlSeconds', 5, { type: 'system' })).rejects.toThrow();
    expect(await t.db.select().from(settings)).toHaveLength(0);
    expect(await t.db.select().from(auditLog)).toHaveLength(0);
  });

  it('isolates tests: reset empties every table', async () => {
    expect(await t.db.select().from(settings)).toHaveLength(0);
  });
});

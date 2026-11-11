import { eq, errorEvents, outbox, settings as settingsTable, workerHeartbeat } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BackupWatch } from '../src/ops/backup-watch.service';
import { OpsNotifier } from '../src/ops/ops-notifier.service';
import { ErrorTracker } from '../src/ops/error-tracker.service';
import { WorkerWatch } from '../src/ops/worker-watch.service';
import { SettingsService } from '../src/settings/settings.service';
import { TEST_INTERNAL_SECRET, createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
let tracker: ErrorTracker;
let watch: WorkerWatch;
let settings: SettingsService;
let backups: BackupWatch;
const DEV = 4242;
const OWNER = 11;
const MIN = 60_000;

beforeAll(async () => {
  t = await createTestApp();
  tracker = t.app.get(ErrorTracker);
  watch = t.app.get(WorkerWatch);
  settings = t.app.get(SettingsService);
  backups = t.app.get(BackupWatch);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.telegram.sent.length = 0;
  await settings.set('ops.developerChatId', DEV, { type: 'system' });
  await settings.set('bot.alertRecipients', [OWNER], { type: 'system' });
});

function failing(message: string): Error {
  return new TypeError(message);
}

describe('error tracking', () => {
  it('files a repeat under one fingerprint, counts it, and pings the developer once', async () => {
    await tracker.record(failing('Ali +998901234567'), 'GET /orders/:id');
    t.edges.clock.advance(5 * MIN);
    await tracker.record(failing('Vali +998907654321'), 'GET /orders/:id');
    await tracker.record(failing('Sali'), 'GET /orders/:id');

    const rows = await t.db.select().from(errorEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3, errorClass: 'TypeError', route: 'GET /orders/:id' });
    expect(rows[0]!.lastSeenAt.getTime() - rows[0]!.firstSeenAt.getTime()).toBe(5 * MIN);

    const pings = await t.db.select().from(outbox);
    expect(pings).toHaveLength(1);
    expect(pings[0]!.chatId).toBe(DEV);
    expect(pings[0]!.text).toContain('TypeError');
  });

  it('pings again for a different error, and stores no personal data anywhere', async () => {
    await tracker.record(failing('Ali +998901234567'), 'GET /a');
    await tracker.record(new RangeError('Amir Temur 1'), 'GET /b');
    expect(await t.db.select().from(outbox)).toHaveLength(2);
    const dump = JSON.stringify([
      await t.db.select().from(errorEvents),
      await t.db.select().from(outbox),
    ]);
    expect(dump).not.toMatch(/998901234567|Amir Temur|Ali/);
  });

  it('pings once when the same new error is recorded many times at once', async () => {
    await Promise.all(Array.from({ length: 12 }, () => tracker.record(failing('x'), 'GET /race')));
    const rows = await t.db.select().from(errorEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(12);
    expect(await t.db.select().from(outbox)).toHaveLength(1);
  });

  it('records quietly while no developer chat is set', async () => {
    await t.db.delete(settingsTable).where(eq(settingsTable.key, 'ops.developerChatId'));
    await tracker.record(failing('x'), 'GET /a');
    expect(await t.db.select().from(errorEvents)).toHaveLength(1);
    expect(await t.db.select().from(outbox)).toHaveLength(0);
  });

  it('files an unexpected 500 from the API by route pattern, without the query string', async () => {
    // a route that fails inside its handler: an unsigned initData body is a 401, so use a bad webhook payload path instead
    const { SafeExceptionFilter } = await import('../src/logging/safe-exception.filter');
    const filter = new SafeExceptionFilter(undefined, tracker);
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/orders/987654321/receipt?name=Ali&phone=998901234567',
        }),
      }),
      getArgByIndex: () => ({}),
    };
    filter.catch(failing('boom'), host as never);
    await new Promise((r) => setTimeout(r, 200));
    const [row] = await t.db.select().from(errorEvents);
    expect(row!.route).toBe('GET /orders/:id/receipt');
  });
});

describe('worker heartbeat watch', () => {
  const sentTo = () => t.edges.telegram.sent.map((m) => m.chatId).sort();

  it('stays quiet while the worker beats', async () => {
    await watch.beat();
    t.edges.clock.advance(2 * MIN);
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(0);
  });

  it('alerts the owner and the developer once after 3 silent minutes, and once on recovery', async () => {
    await watch.beat();
    t.edges.clock.advance(3 * MIN);
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(0); // exactly 3 minutes is not yet "after"

    t.edges.clock.advance(MIN);
    await watch.check();
    expect(sentTo()).toEqual([OWNER, DEV]);
    expect(t.edges.telegram.sent[0]!.text).toContain('молчит');

    t.edges.clock.advance(5 * MIN);
    await watch.check();
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(2); // not again while the outage lasts

    await watch.beat();
    await watch.check();
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(4);
    expect(t.edges.telegram.sent[3]!.text).toContain('снова работает');

    t.edges.clock.advance(10 * MIN);
    await watch.check(); // a second outage alerts again
    expect(t.edges.telegram.sent).toHaveLength(6);
  });

  it('the silence limit is a setting', async () => {
    await settings.set('ops.workerSilentSeconds', 600, { type: 'system' });
    await watch.beat();
    t.edges.clock.advance(9 * MIN);
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(0);
    t.edges.clock.advance(2 * MIN);
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(2);
  });

  it('retries on the next look when the alert reached nobody', async () => {
    await watch.beat();
    t.edges.clock.advance(4 * MIN);
    t.edges.telegram.blockedChats.add(OWNER);
    t.edges.telegram.blockedChats.add(DEV);
    await expect(watch.check()).rejects.toThrow();
    t.edges.telegram.blockedChats.clear();
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(2);
    const [row] = await t.db.select().from(workerHeartbeat);
    expect(row!.outageAlertedAt).not.toBeNull();
  });

  it('an API restart during an outage never reports a recovery while the worker is dead', async () => {
    await watch.beat();
    t.edges.clock.advance(4 * MIN);
    await watch.check();
    expect(t.edges.telegram.sent).toHaveLength(2);

    // the API restarts: a new instance, a fresh start time, the worker still silent
    const restarted = new WorkerWatch(t.db, t.edges, settings, t.app.get(OpsNotifier));
    t.edges.clock.advance(MIN);
    await restarted.check();
    t.edges.clock.advance(10 * MIN);
    await restarted.check();
    expect(t.edges.telegram.sent).toHaveLength(2); // no «снова работает», and no second alarm

    await watch.beat();
    await restarted.check();
    expect(t.edges.telegram.sent).toHaveLength(4);
    expect(t.edges.telegram.sent[3]!.text).toContain('снова работает');
  });

  it('a slow Telegram never blocks the worker beat (no lock held while sending)', async () => {
    await watch.beat();
    t.edges.clock.advance(4 * MIN);
    const send = t.edges.telegram.send.bind(t.edges.telegram);
    t.edges.telegram.send = async (m) => {
      await new Promise((r) => setTimeout(r, 800));
      return send(m);
    };
    try {
      const looking = watch.check();
      await new Promise((r) => setTimeout(r, 150)); // the claim is committed, the sends are in flight
      const started = Date.now();
      await watch.beat();
      expect(Date.now() - started).toBeLessThan(400);
      await looking;
      expect(t.edges.telegram.sent).toHaveLength(2);
    } finally {
      t.edges.telegram.send = send;
    }
  });

  it('two looks at the same time alert once', async () => {
    await watch.beat();
    t.edges.clock.advance(4 * MIN);
    await Promise.all([watch.check(), watch.check()]);
    expect(t.edges.telegram.sent).toHaveLength(2);
  });

  it('the worker tick writes the beat', async () => {
    const worker = t.startWorker();
    await worker.tick();
    const [row] = await t.db.select().from(workerHeartbeat);
    expect(row!.seenAt).toEqual(t.edges.clock.now());
  });
});

describe('backup watch', () => {
  const HOUR = 3_600_000;

  it('stays quiet while reports keep coming', async () => {
    await backups.report([]);
    t.edges.clock.advance(20 * HOUR);
    await backups.check();
    expect(t.edges.telegram.sent).toHaveLength(0);
  });

  it('alerts once when no report comes for longer than the setting, and again only after a new gap', async () => {
    await backups.report([]);
    t.edges.clock.advance(27 * HOUR);
    await backups.check();
    await backups.check();
    expect(t.edges.telegram.sent).toHaveLength(2); // owner + developer
    expect(t.edges.telegram.sent[0]!.text).toContain('Бэкап');

    await backups.report([]); // the gap ends
    t.edges.clock.advance(27 * HOUR);
    await backups.check();
    expect(t.edges.telegram.sent).toHaveLength(4);
  });

  it('alerts a skipped step at most once a day', async () => {
    await backups.report(['second-copy']);
    await backups.report(['second-copy']);
    expect(t.edges.telegram.sent).toHaveLength(2);
    expect(t.edges.telegram.sent[0]!.text).toContain('second-copy');
    t.edges.clock.advance(25 * HOUR);
    await backups.report(['second-copy']);
    expect(t.edges.telegram.sent).toHaveLength(4);
  });

  it('takes the report over the internal endpoint, and refuses it without the secret', async () => {
    const url = `${t.baseUrl}/internal/backup/report`;
    const body = JSON.stringify({ skipped: [] });
    const headers = { 'content-type': 'application/json' };
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(401);
    const ok = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'x-internal-secret': TEST_INTERNAL_SECRET },
      body,
    });
    expect(ok.status).toBe(200);
  });
});

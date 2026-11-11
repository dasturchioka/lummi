import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HumoRelay, type RelayOptions } from '../src/relay';
import { creditText, debitText } from '../src/samples';
import { MtcuteTelegram } from '../src/telegram';
import { FakeFeedApi } from './fakes/fake-api';
import { FakeMtcute, rpcError } from './fakes/fake-mtcute';
import { recordingLogger } from './fakes/logger';

/**
 * The userbot's relay over a fake mtcute client and a fake API (ADR 0014, spec Changes #13 and #36):
 * filtering, forward + post, retry until accepted, catch-up, heartbeat only once caught up.
 */

const HUMO = 777_000; // the listened chat: the Humo bot in production, our test bot elsewhere
const OTHER = 555_001; // any other private chat of the same personal account
const GROUP = -1001234567890; // the orders group (bot.groupChatId)
const MINUTE = 60_000;

const credit = (amount: number) => creditText({ amount, at: new Date('2026-11-11T09:00:00Z') });
const debit = (amount: number) => debitText({ amount, at: new Date('2026-11-11T09:00:00Z') });

let events: string[];
let tg: FakeMtcute;
let api: FakeFeedApi;
let log: ReturnType<typeof recordingLogger>;
let parked: string[];
let relay: HumoRelay;

function makeRelay(o: Partial<RelayOptions> = {}): HumoRelay {
  relay = new HumoRelay({
    telegram: new MtcuteTelegram(tg),
    api,
    log,
    listenChatId: HUMO,
    onParked: (reason) => parked.push(reason),
    ...o,
  });
  return relay;
}

/** Let promises and due timers run. */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-11T09:00:00Z') });
  events = [];
  tg = new FakeMtcute(events);
  tg.cached.add(HUMO).add(GROUP).add(OTHER);
  api = new FakeFeedApi(events);
  log = recordingLogger();
  parked = [];
});
afterEach(() => {
  relay?.stop();
  vi.useRealTimers();
});

describe('what it reads and where it goes', () => {
  it('posts every message of the Humo chat in id order and forwards only the ➕ to «Поступления»', async () => {
    api.stored.set(100, 'earlier');
    tg.addHistory(HUMO, 'old', { id: 99 });
    tg.addHistory(HUMO, credit(99_000), { id: 101 });
    tg.addHistory(HUMO, debit(75_750), { id: 102 });
    tg.addHistory(HUMO, 'Humo: yangiliklar', { id: 103 });
    tg.addHistory(OTHER, credit(5_000), { id: 104 });

    await makeRelay().start();

    expect(events).toEqual(['post 101', 'forward 101', 'post 102', 'post 103', 'beat']);
    expect(tg.forwards).toEqual([
      { fromChatId: HUMO, messages: [101], toChatId: GROUP, toThreadId: 3 },
    ]);
    expect(api.stored.get(101)).toBe(credit(99_000)); // the raw text, exactly
  });

  it('ignores other chats, the account’s own messages and service messages in the Humo chat', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay().start();
    events.length = 0;

    tg.receive(OTHER, credit(1_000));
    tg.receive(HUMO, '/start', { outgoing: true });
    tg.receive(HUMO, credit(2_000), { outgoing: true });
    tg.receive(HUMO, '', { service: true });
    const real = tg.receive(HUMO, credit(3_000));
    await settle();

    expect(events).toEqual([`post ${real.id}`, `forward ${real.id}`]);
    expect(api.attempts).toEqual([real.id]);
  });

  it('forwards to the general chat when the topic is not set, and not at all without a group', async () => {
    api.stored.set(100, 'earlier');
    api.target = { chatId: GROUP, topicId: null };
    await makeRelay().start();

    const a = tg.receive(HUMO, credit(10_000));
    await settle();
    expect(tg.forwards.at(-1)).toEqual({ fromChatId: HUMO, messages: [a.id], toChatId: GROUP });

    api.target = { chatId: null, topicId: null };
    const b = tg.receive(HUMO, credit(20_000));
    await settle();
    expect(api.stored.has(b.id)).toBe(true);
    expect(tg.forwards).toHaveLength(1);
    expect(log.text()).toMatch(/bot\.groupChatId/);
  });
});

describe('posting: retried until accepted, in order', () => {
  it('retries a refused or failed post with growing delays and posts nothing after it meanwhile', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ retry: { firstMs: 1000, maxMs: 4000 } }).start();
    events.length = 0;

    api.failPosts = 4;
    const first = tg.receive(HUMO, credit(1_000));
    const second = tg.receive(HUMO, debit(2_000));
    await settle();
    expect(api.attempts).toEqual([first.id]);

    await settle(1000); // 2nd attempt
    await settle(2000); // 3rd
    await settle(4000); // 4th (capped)
    expect(api.attempts).toEqual([first.id, first.id, first.id, first.id]);
    await settle(4000); // 5th: accepted
    expect(events).toEqual([`post ${first.id}`, `forward ${first.id}`, `post ${second.id}`]);
    expect(api.attempts.filter((id) => id === second.id)).toHaveLength(1);
  });

  it('keeps retrying while the API is unreachable, and never logs the text', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ retry: { firstMs: 1000, maxMs: 60_000 } }).start();

    api.down = true;
    const m = tg.receive(HUMO, credit(123_456));
    await settle(30 * MINUTE);
    expect(api.stored.has(m.id)).toBe(false);
    api.down = false;
    await settle(MINUTE);
    expect(api.stored.get(m.id)).toBe(credit(123_456));

    expect(log.lines.some((l) => l.level === 'warn' && l.fields.messageId === m.id)).toBe(true);
    expect(log.text()).not.toMatch(/123\.456|HUMOCARD|💰/);
  });
});

describe('catch-up', () => {
  it('resumes after the last stored id, posts what was missed, then what arrives meanwhile, each once', async () => {
    api.stored.set(100, 'earlier');
    tg.addHistory(HUMO, credit(1_000), { id: 101 });
    const late = tg.addHistory(HUMO, credit(2_000), { id: 102 });
    api.failPosts = 1; // catch-up stalls on 101 for a moment

    const started = makeRelay({ retry: { firstMs: 1000, maxMs: 1000 } }).start();
    await settle();
    tg.onNewMessage.emit(late); // its update arrives while catch-up runs: a duplicate
    const live = tg.receive(HUMO, credit(3_000), { id: 103 });
    await settle(1000);
    await started;
    await settle();

    expect(tg.historyReads).toEqual([{ chatId: HUMO, afterId: 100 }]);
    expect(events.filter((e) => e.startsWith('post'))).toEqual([
      'post 101',
      'post 102',
      `post ${live.id}`,
    ]);
    expect(api.attempts.filter((id) => id === 102)).toHaveLength(1);
  });

  it('first start with nothing stored: begins after the newest message, the past is not imported', async () => {
    tg.addHistory(HUMO, credit(1_000), { id: 50 });
    tg.addHistory(HUMO, debit(1_000), { id: 60 });
    await makeRelay().start();
    expect(api.attempts).toEqual([]);
    expect(events).toEqual(['beat']);

    const m = tg.receive(HUMO, credit(5_000));
    await settle();
    expect(events).toEqual(['beat', `post ${m.id}`, `forward ${m.id}`]);
    expect(log.text()).toMatch(/nothing stored yet/);
  });

  it('after a reconnect reads the history after the last message it handled, before any heartbeat', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ heartbeatIntervalMs: MINUTE }).start();
    const before = tg.receive(HUMO, credit(1_000));
    await settle();
    events.length = 0;

    tg.setConnection('connecting');
    const missed1 = tg.addHistory(HUMO, credit(2_000)); // arrive while offline, no update
    const missed2 = tg.addHistory(HUMO, debit(3_000));
    await settle(5 * MINUTE);
    expect(events).toEqual([]); // no heartbeat while offline

    tg.setConnection('updating');
    const viaDifference = tg.receive(HUMO, credit(4_000)); // mtcute's own catch-up delivers one
    await settle();
    expect(events).toEqual([]); // held until the history is read

    tg.setConnection('connected');
    await settle();
    expect(tg.historyReads.at(-1)).toEqual({ chatId: HUMO, afterId: before.id });
    expect(events).toEqual([
      `post ${missed1.id}`,
      `forward ${missed1.id}`,
      `post ${missed2.id}`,
      `post ${viaDifference.id}`,
      `forward ${viaDifference.id}`,
      'beat',
    ]);
  });
});

describe('heartbeat: every minute, and only when caught up (#36)', () => {
  it('sends the first one only after catch-up has posted everything, then one a minute', async () => {
    api.stored.set(100, 'earlier');
    tg.addHistory(HUMO, credit(1_000), { id: 101 });
    api.failPosts = 3;

    const started = makeRelay({
      heartbeatIntervalMs: MINUTE,
      retry: { firstMs: 30_000, maxMs: 30_000 },
    }).start();
    await settle(89_000);
    expect(events).toEqual([]); // two minutes of failing posts: no heartbeat
    await settle(1000);
    await started;
    expect(events).toEqual(['post 101', 'forward 101', 'beat']);

    await settle(MINUTE);
    await settle(MINUTE);
    expect(events.filter((e) => e === 'beat')).toHaveLength(3);
  });

  it('skips the beat while a post is stuck, and beats again once it is through', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({
      heartbeatIntervalMs: MINUTE,
      retry: { firstMs: 10_000, maxMs: 10_000 },
    }).start();
    events.length = 0;

    api.failPosts = 15; // 150 s of refusals
    const m = tg.receive(HUMO, credit(1_000));
    await settle(149_000);
    expect(events).toEqual([]);
    await settle(1000);
    expect(events).toEqual([`post ${m.id}`, `forward ${m.id}`, 'beat']);
  });

  it('asks Telegram first, so a session revoked while idle stops the heartbeat within a tick', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ heartbeatIntervalMs: MINUTE }).start();
    expect(api.heartbeats).toBe(1);
    expect(tg.probes).toBe(1);

    tg.probeErrors.push(rpcError(420, 'FLOOD_WAIT_5')); // a hiccup: skip this beat only
    await settle(MINUTE);
    expect(api.heartbeats).toBe(1);
    expect(relay.status).toBe('live');

    tg.probeErrors.push(rpcError(401, 'SESSION_REVOKED'));
    await settle(MINUTE);
    await settle(5 * MINUTE);
    expect(relay.status).toBe('parked');
    expect(api.heartbeats).toBe(1);
  });

  it('parks on a dead-session error mtcute reports in the background', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ heartbeatIntervalMs: MINUTE }).start();
    tg.onError.emit(new Error('some transient thing'));
    expect(relay.status).toBe('live');
    tg.onError.emit(rpcError(401, 'AUTH_KEY_UNREGISTERED'));
    expect(relay.status).toBe('parked');
    await settle(5 * MINUTE);
    expect(api.heartbeats).toBe(1);
    expect(parked).toHaveLength(1);
  });

  it('a failed heartbeat is logged and tried again on the next tick', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ heartbeatIntervalMs: MINUTE }).start();
    api.down = true;
    await settle(MINUTE);
    api.down = false;
    await settle(MINUTE);
    expect(api.heartbeats).toBe(2); // the one after catch-up, then the third tick
    expect(log.lines.some((l) => l.level === 'warn' && /heartbeat/.test(l.msg))).toBe(true);
  });
});

describe('Telegram limits and failures', () => {
  it('waits out a short flood wait on a forward, skips a long one, and never holds the posts back', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ forwardFloodCapSeconds: 120 }).start();
    events.length = 0;

    tg.forwardErrors.push(rpcError(420, 'FLOOD_WAIT_30'));
    const a = tg.receive(HUMO, credit(1_000));
    await settle(30_000);
    expect(tg.forwards).toHaveLength(0);
    await settle(1_000);
    expect(tg.forwards.map((f) => f.messages[0])).toEqual([a.id]);

    tg.forwardErrors.push(rpcError(420, 'FLOOD_WAIT_3600'));
    const b = tg.receive(HUMO, credit(2_000));
    const c = tg.receive(HUMO, debit(3_000));
    await settle();
    expect(events).toEqual([`post ${a.id}`, `forward ${a.id}`, `post ${b.id}`, `post ${c.id}`]);
    expect(log.text()).toMatch(/FLOOD_WAIT_3600|3600/);
  });

  it('a forward Telegram refuses is logged and skipped; the credit is still posted', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay().start();
    tg.forwardErrors.push(rpcError(403, 'CHAT_WRITE_FORBIDDEN'));
    const a = tg.receive(HUMO, credit(1_000));
    const b = tg.receive(HUMO, credit(2_000));
    await settle();
    expect(api.stored.has(a.id) && api.stored.has(b.id)).toBe(true);
    expect(tg.forwards.map((f) => f.messages[0])).toEqual([b.id]);
    expect(log.text()).toMatch(/CHAT_WRITE_FORBIDDEN/);
  });

  it('waits out a flood wait on the history read, then catches up', async () => {
    api.stored.set(100, 'earlier');
    tg.addHistory(HUMO, credit(1_000), { id: 101 });
    tg.historyErrors.push(rpcError(420, 'FLOOD_WAIT_300'));
    const started = makeRelay().start();
    await settle(300_000);
    expect(events).toEqual([]);
    await settle(1_000);
    await started;
    expect(events).toEqual(['post 101', 'forward 101', 'beat']);
  });

  it('finds the chats among the dialogs when the in-memory session has not cached them yet', async () => {
    tg.cached.clear();
    tg.dialogs = [OTHER, GROUP, 555_002, HUMO];
    api.stored.set(100, 'earlier');
    tg.addHistory(HUMO, credit(1_000), { id: 101 });

    await makeRelay().start();
    expect(events).toEqual(['post 101', 'forward 101', 'beat']);
    expect(tg.dialogScans).toBe(1);
  });

  it('a group the account is not in: forwards are skipped, and the dialogs are scanned at most every 10 minutes', async () => {
    tg.cached.delete(GROUP);
    tg.dialogs = [HUMO, OTHER];
    api.stored.set(100, 'earlier');
    await makeRelay().start();

    tg.receive(HUMO, credit(1_000));
    tg.receive(HUMO, credit(2_000));
    await settle();
    expect(tg.forwards).toEqual([]);
    expect(api.stored.size).toBe(3);
    expect(tg.dialogScans).toBe(1);
    expect(log.text()).toMatch(/not among the account's chats/);

    await settle(10 * MINUTE);
    tg.dialogs = [GROUP, HUMO, OTHER]; // the account joined the group
    const later = tg.receive(HUMO, credit(3_000));
    await settle();
    expect(tg.dialogScans).toBe(2);
    expect(tg.forwards.map((f) => f.messages[0])).toEqual([later.id]);
    expect(relay.status).toBe('live');
  });
});

describe('a userbot that cannot work stops and says so, without a crash loop', () => {
  it('parks when the session is dead: no posts, no heartbeats, one clear error', async () => {
    api.stored.set(100, 'earlier');
    tg.historyErrors.push(rpcError(401, 'AUTH_KEY_UNREGISTERED'));
    await makeRelay({ heartbeatIntervalMs: MINUTE }).start();
    await settle(10 * MINUTE);

    expect(relay.status).toBe('parked');
    expect(parked).toHaveLength(1);
    expect(events).toEqual([]);
    expect(log.lines.filter((l) => l.level === 'error')).toHaveLength(1);
    expect(log.text()).toMatch(/log in again/);
  });

  it('parks when the listened chat is not among the account’s chats', async () => {
    tg.cached.clear();
    tg.dialogs = [OTHER];
    api.stored.set(100, 'earlier');
    await makeRelay().start();
    expect(relay.status).toBe('parked');
    expect(parked[0]).toMatch(/777000/);
    expect(events).toEqual([]);
  });

  it('parks at once when the session dies during a catch-up forward (no retry of the read)', async () => {
    api.stored.set(100, 'earlier');
    tg.addHistory(HUMO, credit(1_000), { id: 101 });
    tg.addHistory(HUMO, credit(2_000), { id: 102 });
    tg.forwardErrors.push(rpcError(401, 'SESSION_REVOKED'));
    await makeRelay().start();
    expect(relay.status).toBe('parked');
    expect(events).toEqual(['post 101']);
    expect(tg.historyReads).toHaveLength(1);
    expect(log.lines.filter((l) => l.level === 'warn')).toEqual([]);
  });

  it('parks when the session dies while forwarding', async () => {
    api.stored.set(100, 'earlier');
    await makeRelay({ heartbeatIntervalMs: MINUTE }).start();
    tg.forwardErrors.push(rpcError(401, 'SESSION_REVOKED'));
    tg.receive(HUMO, credit(1_000));
    tg.receive(HUMO, credit(2_000));
    await settle(5 * MINUTE);
    expect(relay.status).toBe('parked');
    expect(events.filter((e) => e.startsWith('post'))).toHaveLength(1);
    expect(events.filter((e) => e === 'beat')).toHaveLength(1); // only the one before
  });
});

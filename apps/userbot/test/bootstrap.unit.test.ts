import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { tl } from '@mtcute/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startUserbot, type BootClient, type Started } from '../src/bootstrap';
import type { Env } from '../src/env';
import { sealSession, writeSessionFile } from '../src/session-crypto';
import { FakeFeedApi } from './fakes/fake-api';
import { FakeMtcute, rpcError } from './fakes/fake-mtcute';
import { recordingLogger } from './fakes/logger';
import { FAKE_SESSION, secretFragments } from './fakes/secrets';

/** Starting the userbot (session file → mtcute → relay), with a fake mtcute client. */

const HUMO = 777_000;

class FakeBootClient extends FakeMtcute implements BootClient {
  imported: string[] = [];
  meError: unknown = null;
  loggedIn = false;
  updatesLoop = false;
  destroyed = false;
  destroyError: unknown = null;
  async importSession(session: string) {
    this.imported.push(session);
  }
  override async getMe() {
    if (this.meError) throw this.meError;
    await super.getMe();
    return { id: 4242, raw: { _: 'user', id: 4242 } as tl.RawUser };
  }
  async notifyLoggedIn() {
    this.loggedIn = true;
  }
  async startUpdatesLoop() {
    this.updatesLoop = true;
  }
  async destroy() {
    this.destroyed = true;
    if (this.destroyError) throw this.destroyError;
  }
}

let dir: string;
let env: Env;
let log: ReturnType<typeof recordingLogger>;
let api: FakeFeedApi;
let client: FakeBootClient;
let started: Started | undefined;
const key = randomBytes(32);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'userbot-boot-'));
  env = {
    NODE_ENV: 'test',
    API_URL: 'http://127.0.0.1:1',
    INTERNAL_API_SECRET: 'x'.repeat(32),
    USERBOT_API_ID: 1,
    USERBOT_API_HASH: '0'.repeat(32),
    USERBOT_SESSION_KEY: key.toString('base64'),
    USERBOT_SESSION_FILE: join(dir, 'session.enc'),
    USERBOT_LISTEN_CHAT_ID: HUMO,
    USERBOT_REQUIRE_VERIFIED: false,
    LOG_LEVEL: 'info',
  };
  log = recordingLogger();
  api = new FakeFeedApi();
  api.stored.set(100, 'earlier');
  client = new FakeBootClient();
  client.cached.add(HUMO);
  client.users.set(HUMO, { isBot: true, isVerified: false });
  started = undefined;
  parkedReasons.length = 0;
});
afterEach(async () => {
  if (started?.kind === 'running') started.relay.stop();
  await rm(dir, { recursive: true, force: true });
});

const parkedReasons: string[] = [];
const start = async () =>
  (started = await startUserbot({
    env,
    log,
    api,
    createClient: () => client,
    onParked: (r) => parkedReasons.push(r),
  }));

describe('startUserbot', () => {
  it('opens the sealed session, checks it, starts updates, catches up, then beats', async () => {
    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, key));
    const s = await start();
    expect(s.kind).toBe('running');
    expect(client.imported).toEqual([FAKE_SESSION]);
    expect(client.loggedIn && client.updatesLoop).toBe(true);
    expect(api.heartbeats).toBe(1);
  });

  it('parks without touching Telegram when there is no session file, or the key does not open it', async () => {
    expect((await start()).kind).toBe('parked');
    expect(log.text()).toMatch(/log in first/);

    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, randomBytes(32)));
    expect((await start()).kind).toBe('parked');
    expect(log.text()).toMatch(/cannot be decrypted/);
    expect(client.imported).toEqual([]);
    expect(api.heartbeats).toBe(0);
    expect(parkedReasons).toHaveLength(2); // main keeps the process up, idle
  });

  it('a relay that parks later (listened chat unknown) also tells main to stay up idle', async () => {
    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, key));
    client.cached.clear();
    client.dialogs = [];
    expect((await start()).kind).toBe('parked');
    expect(parkedReasons[0]).toMatch(/777000/);
    expect(client.destroyed).toBe(true);
  });

  it('parks when Telegram no longer accepts the session, and lets go of the client', async () => {
    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, key));
    client.meError = rpcError(401, 'AUTH_KEY_UNREGISTERED');
    const s = await start();
    expect(s).toMatchObject({ kind: 'parked', reason: expect.stringMatching(/log in again/) });
    expect(client.destroyed).toBe(true);
    expect(client.updatesLoop).toBe(false);
    expect(api.heartbeats).toBe(0);
  });

  it.each([
    ['any 401', () => rpcError(401, 'SOME_NEW_AUTH_ERROR')],
    ['AUTH_KEY_DUPLICATED (406)', () => rpcError(406, 'AUTH_KEY_DUPLICATED')],
  ])('%s at start parks too, even when closing the client fails', async (_name, dead) => {
    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, key));
    client.meError = dead();
    client.destroyError = new Error('socket already closed');
    const s = await start();
    expect(s.kind).toBe('parked');
    expect(parkedReasons).toHaveLength(1);
    expect(client.updatesLoop).toBe(false);
  });

  it('a relay that parks later lets go of the client even if closing it fails', async () => {
    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, key));
    client.historyErrors.push(rpcError(401, 'SESSION_REVOKED'));
    client.destroyError = new Error('socket already closed');
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const s = await start();
      await new Promise((r) => setTimeout(r, 20));
      expect(s).toMatchObject({ kind: 'parked', reason: expect.stringMatching(/log in again/) });
      expect(client.destroyed).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('logs neither the session nor the key on any of these paths', async () => {
    await start(); // no file
    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, randomBytes(32)));
    await start(); // wrong key
    await writeSessionFile(env.USERBOT_SESSION_FILE, sealSession(FAKE_SESSION, key));
    client.meError = rpcError(401, 'SESSION_REVOKED');
    await start(); // dead session
    client = new FakeBootClient();
    client.cached.add(HUMO);
    client.users.set(HUMO, { isBot: true, isVerified: false });
    await start(); // running
    const text = log.text();
    for (const secret of [FAKE_SESSION, key.toString('base64'), env.INTERNAL_API_SECRET]) {
      for (const fragment of secretFragments(secret)) expect(text).not.toContain(fragment);
    }
  });
});

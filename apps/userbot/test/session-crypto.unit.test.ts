import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openSession,
  parseSessionKey,
  readSessionFile,
  sealSession,
  SessionFileError,
  writeSessionFile,
} from '../src/session-crypto';
import { FAKE_SESSION, secretFragments } from './fakes/secrets';

const key = randomBytes(32);

describe('the session string is sealed with AES-256-GCM under the .env key', () => {
  it('round-trips', () => {
    expect(openSession(sealSession(FAKE_SESSION, key), key)).toBe(FAKE_SESSION);
  });

  it('never contains the session in clear, and two seals differ (fresh IV)', () => {
    const a = sealSession(FAKE_SESSION, key);
    const b = sealSession(FAKE_SESSION, key);
    expect(a).not.toBe(b);
    for (const fragment of secretFragments(FAKE_SESSION)) expect(a).not.toContain(fragment);
  });

  it('refuses another key, a flipped bit and a foreign format, saying nothing of the content', () => {
    const sealed = sealSession(FAKE_SESSION, key);
    const flipped = sealed.slice(0, -6) + (sealed.at(-6) === 'A' ? 'B' : 'A') + sealed.slice(-5);
    for (const [input, k] of [
      [sealed, randomBytes(32)],
      [flipped, key],
      ['not a sealed session', key],
      [FAKE_SESSION, key],
    ] as const) {
      let error: unknown;
      try {
        openSession(input, k);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SessionFileError);
      const text = `${String(error)} ${(error as Error).stack}`;
      for (const fragment of secretFragments(FAKE_SESSION)) expect(text).not.toContain(fragment);
    }
  });

  it('takes a key of exactly 32 bytes in base64 and nothing else', () => {
    expect(parseSessionKey(key.toString('base64'))).toEqual(key);
    for (const bad of [
      '',
      'short',
      randomBytes(16).toString('base64'),
      randomBytes(33).toString('base64'),
      '!!!!',
    ]) {
      expect(() => parseSessionKey(bad)).toThrow(/32 bytes/);
    }
  });
});

describe('the session file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'userbot-session-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('is written readable by its owner only, in a folder only its owner can enter', async () => {
    const file = join(dir, 'sub', 'session.enc');
    await writeSessionFile(file, sealSession(FAKE_SESSION, key));
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'sub'))).mode & 0o777).toBe(0o700);
    expect(openSession(await readSessionFile(file), key)).toBe(FAKE_SESSION);
    expect(await readFile(file, 'utf8')).not.toContain(FAKE_SESSION);
  });

  it('a second write replaces the first in one step (no half-written file)', async () => {
    const file = join(dir, 'session.enc');
    await writeSessionFile(file, sealSession('first', key));
    await writeSessionFile(file, sealSession(FAKE_SESSION, key));
    expect(openSession(await readSessionFile(file), key)).toBe(FAKE_SESSION);
  });

  it('a missing file is a SessionFileError that says to log in', async () => {
    await expect(readSessionFile(join(dir, 'nope.enc'))).rejects.toThrow(SessionFileError);
    await expect(readSessionFile(join(dir, 'nope.enc'))).rejects.toThrow(/log in/);
  });

  it('refuses a file others can read', async () => {
    const file = join(dir, 'open.enc');
    await writeFile(file, sealSession(FAKE_SESSION, key), { mode: 0o644 });
    await expect(readSessionFile(file)).rejects.toThrow(/readable by others/);
  });
});

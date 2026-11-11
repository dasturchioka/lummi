import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { login, type LoginClient, type LoginStartParams, type Prompt } from '../src/login';
import { openSession, readSessionFile } from '../src/session-crypto';
import { FAKE_SESSION, secretFragments } from './fakes/secrets';

/**
 * The login CLI (ADR 0014): phone, code, 2FA password → the session string, sealed with the .env
 * key into the session file. Driven with a fake mtcute client: nothing here reaches Telegram.
 */

class FakeLoginClient implements LoginClient {
  asked: string[] = [];
  destroyed = false;
  loggedOut = false;
  constructor(
    private readonly o: {
      needs2fa?: boolean;
      firstCodeWrong?: boolean;
      isBot?: boolean;
      /** The account has a two-step verification password (default: yes). */
      hasPassword?: boolean;
    } = {},
  ) {}

  async start(p: LoginStartParams) {
    this.asked.push(`phone ${await p.phone()}`);
    p.codeSentCallback?.({ type: 'app' });
    let code = await p.code();
    if (this.o.firstCodeWrong) {
      await p.invalidCodeCallback?.('code');
      code = await p.code();
    }
    this.asked.push(`code ${code}`);
    if (this.o.needs2fa) this.asked.push(`password ${await p.password()}`);
    return { id: 4242, isBot: this.o.isBot ?? false };
  }
  async exportSession() {
    return FAKE_SESSION;
  }
  async hasTwoStepPassword() {
    return this.o.hasPassword ?? true;
  }
  async logOut() {
    this.loggedOut = true;
  }
  async destroy() {
    this.destroyed = true;
  }
}

/** Scripted answers; records what was asked and said, and how (hidden or not). */
function scriptedPrompt(answers: Record<string, string[]>) {
  const said: string[] = [];
  const asked: { question: string; hidden: boolean }[] = [];
  const next = (question: string, hidden: boolean) => {
    asked.push({ question, hidden });
    const key = Object.keys(answers).find((k) => question.toLowerCase().includes(k))!;
    return Promise.resolve(answers[key]!.shift()!);
  };
  const prompt: Prompt = {
    ask: (q) => next(q, false),
    askHidden: (q) => next(q, true),
    say: (line) => said.push(line),
  };
  return { prompt, said, asked };
}

let dir: string;
let file: string;
const key = randomBytes(32);
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'userbot-login-'));
  file = join(dir, 'userbot', 'session.enc');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('login', () => {
  it('asks phone, code and 2FA password (hidden), and stores the session sealed', async () => {
    const client = new FakeLoginClient({ needs2fa: true });
    const { prompt, asked } = scriptedPrompt({
      phone: ['+998901234567'],
      code: ['12345'],
      password: ['hunter2'],
    });
    await login({ client, prompt, sessionFile: file, key, force: false });

    expect(client.asked).toEqual(['phone +998901234567', 'code 12345', 'password hunter2']);
    expect(asked.find((a) => /password/i.test(a.question))?.hidden).toBe(true);
    expect(openSession(await readSessionFile(file), key)).toBe(FAKE_SESSION);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(client.destroyed).toBe(true);
    expect(client.loggedOut).toBe(false); // closing the CLI must not end the new session
  });

  it('asks for the code again when Telegram says it was wrong', async () => {
    const client = new FakeLoginClient({ firstCodeWrong: true });
    const { prompt } = scriptedPrompt({ phone: ['+998901234567'], code: ['11111', '22222'] });
    await login({ client, prompt, sessionFile: file, key, force: false });
    expect(client.asked).toEqual(['phone +998901234567', 'code 22222']);
  });

  it('never prints, logs or leaves in an error the session string, the key or the password', async () => {
    const out: string[] = [];
    const capture = (...args: unknown[]) => void out.push(args.map(String).join(' '));
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'info').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture),
      vi.spyOn(console, 'error').mockImplementation(capture),
      vi.spyOn(process.stdout, 'write').mockImplementation((c) => (capture(c), true)),
      vi.spyOn(process.stderr, 'write').mockImplementation((c) => (capture(c), true)),
    ];
    try {
      const { prompt, said } = scriptedPrompt({
        phone: ['+998901234567', '+998901234567'],
        code: ['12345', '12345'],
        password: ['hunter2-secret-pass', 'hunter2-secret-pass'],
      });
      await login({
        client: new FakeLoginClient({ needs2fa: true }),
        prompt,
        sessionFile: file,
        key,
        force: false,
      });
      // A second login without --force refuses; its error is checked too.
      const error = await login({
        client: new FakeLoginClient({ needs2fa: true }),
        prompt,
        sessionFile: file,
        key,
        force: false,
      }).catch((e: unknown) => e);
      out.push(...said, String(error), (error as Error).stack ?? '');
    } finally {
      for (const s of spies) s.mockRestore();
    }

    const everything = out.join('\n');
    expect(everything).toMatch(/session/i); // it did say where the session went
    for (const secret of [FAKE_SESSION, key.toString('base64'), 'hunter2-secret-pass']) {
      for (const fragment of secretFragments(secret)) expect(everything).not.toContain(fragment);
    }
    expect(await readFile(file, 'utf8')).not.toContain(FAKE_SESSION);
  });

  it('refuses to replace an existing session unless forced, and then says to end the old one', async () => {
    const answers = () =>
      scriptedPrompt({ phone: ['+998901234567'], code: ['1'], password: ['p'] }).prompt;
    await login({
      client: new FakeLoginClient(),
      prompt: answers(),
      sessionFile: file,
      key,
      force: false,
    });

    const second = new FakeLoginClient();
    await expect(
      login({ client: second, prompt: answers(), sessionFile: file, key, force: false }),
    ).rejects.toThrow(/--force/);
    expect(second.asked).toEqual([]); // nothing was sent to Telegram

    const { prompt, said } = scriptedPrompt({
      phone: ['+998901234567'],
      code: ['1'],
      password: ['p'],
    });
    await login({ client: new FakeLoginClient(), prompt, sessionFile: file, key, force: true });
    expect(said.join('\n')).toMatch(/Devices/);
  });

  it('refuses an account without a two-step password: stores nothing and ends the new session', async () => {
    const { prompt } = scriptedPrompt({ phone: ['+998901234567'], code: ['1'] });
    const client = new FakeLoginClient({ hasPassword: false });
    await expect(login({ client, prompt, sessionFile: file, key, force: false })).rejects.toThrow(
      /Two-Step Verification/,
    );
    await expect(stat(file)).rejects.toThrow();
    expect(client.loggedOut).toBe(true);
    expect(client.destroyed).toBe(true);
  });

  it('ends the new session when the session file cannot be written', async () => {
    const blocker = join(dir, 'not-a-dir');
    await writeFile(blocker, '');
    const { prompt } = scriptedPrompt({ phone: ['+998901234567'], code: ['1'], password: ['p'] });
    const client = new FakeLoginClient({ needs2fa: true });
    await expect(
      login({ client, prompt, sessionFile: join(blocker, 'session.enc'), key, force: false }),
    ).rejects.toThrow();
    expect(client.loggedOut).toBe(true);
  });

  it('refuses a bot account and stores nothing', async () => {
    const { prompt } = scriptedPrompt({ phone: ['+998901234567'], code: ['1'] });
    const client = new FakeLoginClient({ isBot: true });
    await expect(login({ client, prompt, sessionFile: file, key, force: false })).rejects.toThrow(
      /bot/,
    );
    await expect(stat(file)).rejects.toThrow();
    expect(client.loggedOut).toBe(true);
  });
});

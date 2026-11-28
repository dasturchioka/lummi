import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager, type AuthResult, type SessionDeps } from './session';

const TTL = 3_600_000;
let clock = 0;
const issue = (n: number): AuthResult => ({ ok: true, token: `t${n}`, expiresAt: clock + TTL });

function setup(over: Partial<SessionDeps> = {}) {
  let n = 0;
  const deps = {
    signIn: vi.fn(async () => issue(++n)),
    refresh: vi.fn(async () => issue(++n)),
    initData: vi.fn(() => 'init'),
    now: () => clock,
    ...over,
  };
  return { deps, session: new SessionManager(deps) };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.useRealTimers());

const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

describe('SessionManager', () => {
  it('signs in once on launch and reuses the token', async () => {
    const { deps, session } = setup();
    await session.start();
    expect(session.getState()).toBe('active');
    expect(await session.getToken()).toBe('t1');
    expect(await session.getToken()).toBe('t1');
    expect(deps.signIn).toHaveBeenCalledTimes(1);
  });

  it('refreshes proactively before expiry without touching initData', async () => {
    const { deps, session } = setup();
    await session.start();
    await advance(TTL * 0.85);
    expect(deps.refresh).toHaveBeenCalledWith('t1');
    expect(deps.signIn).toHaveBeenCalledTimes(1);
    expect(await session.getToken()).toBe('t2');
  });

  it('refreshes on resume when the timer slept through the margin', async () => {
    const { deps, session } = setup();
    await session.start();
    const listeners: Record<string, () => void> = {};
    const doc = {
      visibilityState: 'visible',
      addEventListener: (e: string, h: () => void) => (listeners[e] = h),
      removeEventListener: vi.fn(),
    };
    session.attach(doc);
    clock += TTL * 0.9; // asleep: timers did not run
    listeners.visibilitychange?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('signs in again with initData only when the session is gone', async () => {
    const { deps, session } = setup({
      refresh: vi.fn(async () => ({ ok: false, reason: 'unauthorized' }) as AuthResult),
    });
    await session.start();
    await advance(TTL * 0.85);
    expect(deps.signIn).toHaveBeenCalledTimes(2);
    expect(session.getState()).toBe('active');
  });

  it('signs in again after a 401 from the API (recover)', async () => {
    const { deps, session } = setup();
    await session.start();
    const fresh = await session.recover('t1');
    expect(fresh).toBe('t2');
    expect(deps.signIn).toHaveBeenCalledTimes(2);
  });

  it('goes to "reopen" when initData is stale, and does not loop', async () => {
    const { deps, session } = setup({
      signIn: vi.fn(async () => ({ ok: false, reason: 'stale' }) as AuthResult),
    });
    await session.start();
    expect(session.getState()).toBe('reopen');
    await expect(session.getToken()).rejects.toThrow('reopen');
    expect(deps.signIn).toHaveBeenCalledTimes(1);
  });

  it('keeps a still-valid token through a network blip and fails when none is left', async () => {
    const { session } = setup({
      refresh: vi.fn(async () => {
        throw new TypeError('offline');
      }),
    });
    await session.start();
    await advance(TTL * 0.85);
    expect(session.getState()).toBe('active');

    const cold = setup({
      signIn: vi.fn(async () => {
        throw new TypeError('offline');
      }),
    });
    await expect(cold.session.start()).rejects.toThrow('offline');
    expect(cold.session.getState()).toBe('failed');
  });

  it('coalesces concurrent renewals into one request', async () => {
    const { deps, session } = setup();
    await Promise.all([session.start(), session.start(), session.getToken().catch(() => 0)]);
    expect(deps.signIn).toHaveBeenCalledTimes(1);
  });
});

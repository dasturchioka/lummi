/**
 * The customer session (ADR 0029): sign in once with the Telegram initData, then keep a
 * short-lived token fresh. Framework-free so it is unit-tested with fake timers.
 *
 *  - refresh BEFORE expiry (timer) and on resume (visibilitychange), swapping the old token;
 *  - sign in with initData again only when the session is gone (refresh refused, token expired);
 *  - stale initData (the app was left open for ages) is not an error to hide: state `reopen`.
 */
export type SessionState = 'idle' | 'signing-in' | 'active' | 'reopen' | 'failed';

export type AuthResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: 'stale' | 'invalid' | 'unauthorized' };

export interface SessionDeps {
  /** Resolve to a result for any HTTP answer; throw only for network failures. */
  signIn(initData: string): Promise<AuthResult>;
  refresh(token: string): Promise<AuthResult>;
  initData(): string | null;
  now(): number;
  /** ms before expiry at which to refresh. Default: the larger of 30 s and 20% of the lifetime. */
  refreshMarginMs?: (lifetimeMs: number) => number;
  retryMs?: number;
}

export class SessionUnavailableError extends Error {
  constructor(readonly state: SessionState) {
    super(`session unavailable: ${state}`);
  }
}

const defaultMargin = (lifetime: number) => Math.max(30_000, lifetime * 0.2);

export class SessionManager {
  private state: SessionState = 'idle';
  private token: string | null = null;
  private expiresAt = 0;
  private lifetime = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SessionDeps) {}

  getState = (): SessionState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Sign in on launch. Safe to call again from the "try again" button. */
  start(): Promise<void> {
    return this.renew({ forceSignIn: false });
  }

  /** A usable token for a request, refreshing or signing in first if needed. */
  async getToken(): Promise<string> {
    if (this.state === 'reopen') throw new SessionUnavailableError(this.state);
    if (!this.token || this.deps.now() >= this.expiresAt - 5_000) {
      await this.renew({ forceSignIn: false });
    } else if (this.deps.now() >= this.expiresAt - this.margin()) {
      await this.renew({ forceSignIn: false }).catch(() => undefined);
    }
    if (!this.token || this.state !== 'active') throw new SessionUnavailableError(this.state);
    return this.token;
  }

  /** The server refused our token (401): the session is gone, sign in again. */
  async recover(rejected: string): Promise<string> {
    if (this.state === 'reopen') throw new SessionUnavailableError(this.state);
    if (this.token === rejected) {
      this.token = null;
      await this.renew({ forceSignIn: true });
    } else {
      await this.renew({ forceSignIn: false }); // someone already replaced it
    }
    if (!this.token || this.state !== 'active') throw new SessionUnavailableError(this.state);
    return this.token;
  }

  /** The app came back to the foreground; timers may have slept through the expiry. */
  onResume(): void {
    if (this.state === 'idle' || this.state === 'reopen') return;
    const left = this.expiresAt - this.deps.now();
    if (this.state === 'failed' || left <= this.margin())
      void this.renew({ forceSignIn: false }).catch(() => undefined);
  }

  /** Wire `visibilitychange`; returns the cleanup. */
  attach(doc: {
    visibilityState: string;
    addEventListener(type: 'visibilitychange', handler: () => void): void;
    removeEventListener(type: 'visibilitychange', handler: () => void): void;
  }) {
    const handler = () => {
      if (doc.visibilityState === 'visible') this.onResume();
    };
    doc.addEventListener('visibilitychange', handler);
    return () => {
      doc.removeEventListener('visibilitychange', handler);
      clearTimeout(this.timer);
    };
  }

  private margin() {
    return (this.deps.refreshMarginMs ?? defaultMargin)(this.lifetime);
  }

  private set(state: SessionState) {
    if (this.state === state) return;
    this.state = state;
    this.listeners.forEach((l) => l());
  }

  private renew(opts: { forceSignIn: boolean }): Promise<void> {
    this.inflight ??= this.doRenew(opts).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRenew({ forceSignIn }: { forceSignIn: boolean }): Promise<void> {
    const hadSession = this.state === 'active';
    if (!hadSession) this.set('signing-in');
    try {
      if (this.token && !forceSignIn && this.deps.now() < this.expiresAt) {
        const r = await this.deps.refresh(this.token);
        if (r.ok) return this.accept(r);
        this.token = null; // refused: the session is gone, fall through to initData
      }
      const initData = this.deps.initData();
      if (!initData) return this.set('reopen');
      const r = await this.deps.signIn(initData);
      if (r.ok) return this.accept(r);
      this.token = null;
      this.set('reopen');
    } catch (e) {
      // Network trouble. A still-valid token keeps working; retry in the background.
      if (this.token && this.deps.now() < this.expiresAt) {
        this.set('active');
        this.schedule(this.deps.retryMs ?? 15_000);
        return;
      }
      this.token = null;
      this.set('failed');
      throw e;
    }
  }

  private accept(r: Extract<AuthResult, { ok: true }>) {
    this.token = r.token;
    this.expiresAt = r.expiresAt;
    this.lifetime = Math.max(0, r.expiresAt - this.deps.now());
    this.set('active');
    this.schedule(Math.max(1_000, this.lifetime - this.margin()));
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.renew({ forceSignIn: false }).catch(() => undefined);
    }, ms);
  }
}

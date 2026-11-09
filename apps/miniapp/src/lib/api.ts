import { createClient, type Sender } from './client';
import { SessionManager, type AuthResult } from './session';
import { rawInitData } from './telegram';

/** Same-origin `/api/*` (Vite proxy in dev, Caddy in production): no CORS, no absolute URLs. */
const baseUrl = import.meta.env.VITE_API_URL ?? '/api';

const anonymous = createClient(baseUrl);

const expiry = (iso: string) => Date.parse(iso);

function toResult(res: { status: number; body: unknown }): AuthResult {
  if (res.status === 200) {
    const b = res.body as { token: string; expiresAt: string };
    return { ok: true, token: b.token, expiresAt: expiry(b.expiresAt) };
  }
  if (res.status === 401) {
    const code = (res.body as { code?: string }).code;
    if (code === 'expired_init_data') return { ok: false, reason: 'stale' };
    return { ok: false, reason: code === 'invalid_init_data' ? 'invalid' : 'unauthorized' };
  }
  throw new Error(`auth failed: HTTP ${res.status}`);
}

export const session = new SessionManager({
  signIn: async (initData) => toResult(await anonymous.auth.telegram({ body: { initData } })),
  refresh: async (token) =>
    toResult(await anonymous.auth.refresh({ extraHeaders: { authorization: `Bearer ${token}` } })),
  initData: rawInitData,
  now: () => Date.now(),
});

/** Attaches the session to every request; a 401 means the session is gone, so sign in once more. */
const authedSend: Sender = async (req) => {
  const send = (token: string) =>
    fetch(req.url, { ...req, headers: { ...req.headers, authorization: `Bearer ${token}` } });
  const token = await session.getToken();
  const res = await send(token);
  if (res.status !== 401) return res;
  return send(await session.recover(token));
};

export const api = createClient(baseUrl, authedSend);

/** Query helper: only the success status is data; anything else is an error to show and retry. */
export function unwrap<T extends { status: number; body: unknown }, S extends number>(
  res: T,
  status: S,
): Extract<T, { status: S }>['body'] {
  if (res.status !== status) throw new Error(`HTTP ${res.status}`);
  return res.body as Extract<T, { status: S }>['body'];
}

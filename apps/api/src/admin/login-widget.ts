import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type LoginWidgetFailure = 'malformed' | 'bad_signature' | 'stale' | 'future';

export class LoginWidgetError extends Error {
  constructor(readonly reason: LoginWidgetFailure) {
    super(`login widget payload rejected: ${reason}`);
  }
}

export interface LoginWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  authDate: Date;
}

export interface LoginWidgetOptions {
  botToken: string;
  now: Date;
  maxAgeSeconds: number;
  maxFutureSkewSeconds: number;
}

/**
 * Verify a Telegram Login Widget payload (ADR 0017). Different from Mini App initData:
 * key = SHA-256(bot token); data-check-string = every received field except `hash`,
 * sorted, `key=value` joined by "\n"; HMAC-SHA256 as hex. Then `auth_date` freshness.
 */
export function verifyLoginWidget(
  payload: Record<string, unknown>,
  opts: LoginWidgetOptions,
): LoginWidgetUser {
  const { hash, ...fields } = payload;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new LoginWidgetError('malformed');
  }
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  const checkString = entries
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
    .join('\n');
  const key = createHash('sha256').update(opts.botToken).digest();
  const expected = createHmac('sha256', key).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) {
    throw new LoginWidgetError('bad_signature');
  }

  const id = Number(fields.id);
  const authDate = Number(fields.auth_date);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(authDate)) {
    throw new LoginWidgetError('malformed');
  }
  const ageSeconds = opts.now.getTime() / 1000 - authDate;
  if (ageSeconds > opts.maxAgeSeconds) throw new LoginWidgetError('stale');
  if (ageSeconds < -opts.maxFutureSkewSeconds) throw new LoginWidgetError('future');
  if (typeof fields.first_name !== 'string' || !fields.first_name) {
    throw new LoginWidgetError('malformed');
  }
  return {
    id,
    first_name: fields.first_name,
    last_name: typeof fields.last_name === 'string' ? fields.last_name : undefined,
    username: typeof fields.username === 'string' ? fields.username : undefined,
    authDate: new Date(authDate * 1000),
  };
}

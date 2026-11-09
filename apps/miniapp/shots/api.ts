import { contract } from '@lummi/contracts';
import { initClient } from '@ts-rest/core';
import { createHmac } from 'node:crypto';

export interface ShotUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** The one customer every screenshot is taken as. */
export const SHOT_USER: ShotUser = {
  id: 700_000_001,
  first_name: 'Dilnoza',
  last_name: 'Karimova',
  username: 'dilnoza_k',
  language_code: 'ru',
};

/** initData signed the way Telegram does, with the dev bot token (the API verifies it for real). */
export function signInitData(botToken: string, user: ShotUser, ageSeconds = 0): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000) - ageSeconds),
    user: JSON.stringify(user),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  // Real initData also carries an Ed25519 `signature` (not part of the HMAC); the SDK's parser requires it.
  return new URLSearchParams({ ...fields, hash, signature: 'dev-signature' }).toString();
}

/** The signed payload `requestContact` returns, signed with the dev bot token (the API verifies it). */
export function signContact(botToken: string, userId: number, phone: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    contact: JSON.stringify({ user_id: userId, phone_number: phone, first_name: 'Dilnoza' }),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

export type ApiClient = ReturnType<typeof makeClient>;

export function makeClient(baseUrl: string, token?: string) {
  return initClient(contract, {
    baseUrl,
    baseHeaders: token ? { authorization: `Bearer ${token}` } : {},
    throwOnUnknownStatus: true,
  });
}

/** Sign in against the real API and return a client bound to the session. */
export async function signedInClient(baseUrl: string, botToken: string, user = SHOT_USER) {
  const res = await makeClient(baseUrl).auth.telegram({
    body: { initData: signInitData(botToken, user) },
  });
  if (res.status !== 200) throw new Error(`screenshot sign-in failed: HTTP ${res.status}`);
  return makeClient(baseUrl, res.body.token);
}

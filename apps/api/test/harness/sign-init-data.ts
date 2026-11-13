import { createHmac } from 'node:crypto';

export interface TestUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface SignOptions {
  botToken: string;
  user?: TestUser;
  /** Unix seconds. */
  authDate: number;
  /** Extra fields (signed too), e.g. query_id. */
  extra?: Record<string, string>;
  /** Appended after signing (not covered by the hash), e.g. a duplicate or a forged field. */
  unsignedSuffix?: [string, string][];
}

export const DEFAULT_TEST_USER: TestUser = { id: 100001, first_name: 'Test', language_code: 'ru' };

/** Build `initData` the way Telegram does, signed with the (test) bot token. */
export function signInitData(opts: SignOptions): string {
  const fields: Record<string, string> = {
    auth_date: String(opts.authDate),
    user: JSON.stringify(opts.user ?? DEFAULT_TEST_USER),
    ...opts.extra,
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(opts.botToken).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const params = new URLSearchParams({ ...fields, hash });
  for (const [k, v] of opts.unsignedSuffix ?? []) params.append(k, v);
  return params.toString();
}

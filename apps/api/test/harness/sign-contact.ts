import { createHmac } from 'node:crypto';

export interface SignContactOptions {
  botToken: string;
  userId: number;
  phone: string;
  /** Unix seconds. */
  authDate: number;
  firstName?: string;
}

/** The payload `requestContact` returns, signed the way Telegram signs it (same scheme as initData). */
export function signContact(opts: SignContactOptions): string {
  const fields: Record<string, string> = {
    auth_date: String(opts.authDate),
    contact: JSON.stringify({
      user_id: opts.userId,
      phone_number: opts.phone,
      first_name: opts.firstName ?? 'Test',
    }),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(opts.botToken).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

import { createHash, createHmac } from 'node:crypto';

export interface WidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

/** Build the Login Widget payload the way Telegram does: HMAC-SHA256 keyed by SHA-256(bot token). */
export function signLoginWidget(opts: {
  botToken: string;
  user: WidgetUser;
  authDate: number;
}): Record<string, string | number> {
  const fields: Record<string, string | number> = { ...opts.user, auth_date: opts.authDate };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const key = createHash('sha256').update(opts.botToken).digest();
  return { ...fields, hash: createHmac('sha256', key).update(check).digest('hex') };
}

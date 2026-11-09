import { z } from 'zod';
import { SignedPayloadError, verifySignedPayload, type VerifyOptions } from './signed-payload';

const userSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});
export type InitDataUser = z.infer<typeof userSchema>;

export interface VerifiedInitData {
  user: InitDataUser;
  authDate: Date;
}

/** Verify Telegram Mini App initData (ADR 0029): the shared signature and age check, then the user. */
export function verifyInitData(raw: string, opts: VerifyOptions): VerifiedInitData {
  const { fields, authDate } = verifySignedPayload(raw, opts);
  const userRaw = fields.get('user');
  if (!userRaw) throw new SignedPayloadError('malformed');
  let user: InitDataUser;
  try {
    user = userSchema.parse(JSON.parse(userRaw));
  } catch {
    throw new SignedPayloadError('malformed');
  }
  return { user, authDate };
}

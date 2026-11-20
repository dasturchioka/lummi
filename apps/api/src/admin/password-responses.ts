import type { PasswordRefusal } from '../staff/staff.service';

/** The one mapping of a refused new password (ADR 0038): 422 with the setting, for the message. */
export const passwordRefused = (res: PasswordRefusal) => ({
  status: 422 as const,
  body: { code: res.reason, minLength: res.minLength },
});

/** Too many attempts for this login or address: 429 with when to try again. */
export const lockedOut = (retryAt: Date) => ({
  status: 429 as const,
  body: { code: 'locked' as const, retryAt: retryAt.toISOString() },
});

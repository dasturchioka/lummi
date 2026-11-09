const NBSP = '\u00a0';

/**
 * An account phone (E.164: `+` and digits) for display. Uzbek numbers group as
 * `+998 90 123 45 67` with no-break spaces, so the number never wraps; others are shown as stored.
 */
export function formatPhone(e164: string): string {
  const uz = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return uz ? ['+998', ...uz.slice(1)].join(NBSP) : e164;
}

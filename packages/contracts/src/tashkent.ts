/**
 * Asia/Tashkent wall clock ↔ UTC, the one place for it (CLAUDE.md: schedules and day-based rules
 * run in Asia/Tashkent; ADR 0016: instants are stored as UTC). Uzbekistan keeps UTC+05:00 all year
 * (no DST since 1992), so this is a fixed offset. Months are 1–12.
 */
const OFFSET_MS = 5 * 60 * 60 * 1000;

export interface TashkentDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** The UTC instant of a Tashkent wall-clock time; null when the fields are not a real date-time. */
export function tashkentToUtc(local: TashkentDateTime): Date | null {
  const { year, month, day, hour, minute, second = 0 } = local;
  const parts = [year, month, day, hour, minute, second];
  if (!parts.every(Number.isInteger)) return null;
  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls 31.02 over to March and 24:00 to the next day; reading back catches both.
  const expected = { year, month, day, hour, minute, second };
  const back = utcFields(asUtc);
  const fits = (Object.keys(expected) as (keyof typeof expected)[]).every(
    (k) => back[k] === expected[k],
  );
  return fits ? new Date(asUtc.getTime() - OFFSET_MS) : null;
}

/** The Tashkent wall-clock fields of a UTC instant. */
export function utcToTashkent(instant: Date): Required<TashkentDateTime> {
  return utcFields(new Date(instant.getTime() + OFFSET_MS));
}

function utcFields(d: Date): Required<TashkentDateTime> {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

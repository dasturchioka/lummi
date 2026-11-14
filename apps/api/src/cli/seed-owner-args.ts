import { STAFF_LOGIN_PATTERN } from '@lummi/contracts';

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** A login as the panel takes it: trimmed, lower case, 3–32 of `a-z 0-9 . _ -` (ADR 0038). */
function parseLogin(raw: string | undefined): string | undefined | null {
  if (raw === undefined) return undefined;
  const login = raw.trim().toLowerCase();
  return STAFF_LOGIN_PATTERN.test(login) ? login : null;
}

/**
 * Parses `--name <text>` plus `--telegram-id <n>` and/or `--login <login>` (at least one: the
 * owner's way in); throws a readable message on bad input.
 */
export function parseSeedOwnerArgs(argv: string[]): {
  telegramId?: number;
  login?: string;
  name: string;
} {
  const rawId = flag(argv, '--telegram-id');
  const telegramId = rawId === undefined ? undefined : Number(rawId);
  const login = parseLogin(flag(argv, '--login'));
  const name = (flag(argv, '--name') ?? '').trim();
  const badId = telegramId !== undefined && (!Number.isSafeInteger(telegramId) || telegramId <= 0);
  if (!name || badId || login === null || (telegramId === undefined && login === undefined)) {
    throw new Error(
      'Usage: seed:owner --name "<name>" [--login <3-32 of a-z 0-9 . _ ->] [--telegram-id <positive integer>] (at least one of --login, --telegram-id)',
    );
  }
  return {
    ...(telegramId === undefined ? {} : { telegramId }),
    ...(login === undefined ? {} : { login }),
    name,
  };
}

/** Parses `--login <login>` for `set-owner-password`. */
export function parseSetOwnerPasswordArgs(argv: string[]): { login: string } {
  const login = parseLogin(flag(argv, '--login'));
  if (!login) throw new Error('Usage: set-owner-password --login <the owner’s login>');
  return { login };
}

/** Parses `--telegram-id <n> --name <text>`; throws a readable message on bad input. */
export function parseSeedOwnerArgs(argv: string[]): { telegramId: number; name: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const telegramId = Number(get('--telegram-id'));
  const name = (get('--name') ?? '').trim();
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || !name) {
    throw new Error('Usage: seed:owner --telegram-id <positive integer> --name "<name>"');
  }
  return { telegramId, name };
}

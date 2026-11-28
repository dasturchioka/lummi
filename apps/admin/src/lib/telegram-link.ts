/** A customer's Telegram link: their @username when they have one, otherwise the id deep link. */
export function telegramLink(c: { username: string | null; telegramId: number }): string {
  return c.username ? `https://t.me/${c.username}` : `tg://user?id=${c.telegramId}`;
}

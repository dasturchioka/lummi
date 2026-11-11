/**
 * Which Humo messages are forwarded to «Поступления» (ADR 0014): those reporting a credit. As in
 * the API's parser (spec Changes 2026-11-09), a message reports a card operation when exactly one
 * line starts with ➕ or ➖. Here only the sign matters: a ➕ whose amount the API cannot read is
 * still forwarded, so the staff see the money even when it is flagged. Whether it is recorded as a
 * credit is the API's decision alone (the userbot posts every message).
 */
export function isCreditNotification(text: string): boolean {
  const operations = text
    .split(/\r?\n/)
    .map((line) => line.replaceAll('️', '').trim())
    .filter((line) => line.startsWith('➕') || line.startsWith('➖'));
  return operations.length === 1 && operations[0]!.startsWith('➕');
}

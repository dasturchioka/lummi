import { userbotHeartbeat, type Db } from '@lummi/db';

/** The userbot's last heartbeat as stored; null before the first. */
export async function userbotLastSeenAt(db: Db): Promise<Date | null> {
  const [row] = await db.select({ seenAt: userbotHeartbeat.seenAt }).from(userbotHeartbeat);
  return row?.seenAt ?? null;
}

import { HOME_QUEUES, type HomeQueue } from '@lummi/contracts';
import type { StaffRole } from '@lummi/db';

/** What takes the Home's Now slot (#48). */
export type NowPick = 'no_card' | 'humo_pause' | HomeQueue | 'clear';

/**
 * The one item lifted out of the queue, in this order:
 * 1. no shop card, for the owner only: checkout is closed and only the owner can fix it (a
 *    manager sees a line above the Now block instead and keeps their own item);
 * 2. an open payment pause, for both roles: receipts are not confirmed by themselves meanwhile;
 * 3. the first queue in `HOME_QUEUES` order that is not empty;
 * 4. `clear` («Всё сделано») when every queue is empty.
 */
export function pickNow(s: {
  role: StaffRole;
  cardMissing: boolean;
  paused: boolean;
  counts: Record<HomeQueue, number>;
}): NowPick {
  if (s.cardMissing && s.role === 'owner') return 'no_card';
  if (s.paused) return 'humo_pause';
  return HOME_QUEUES.find((q) => s.counts[q] > 0) ?? 'clear';
}

import type { tl } from '@mtcute/node';
import type { Env } from './env';
import type { FeedApi } from './feed-api';
import type { Logger } from './logger';
import { HumoRelay, logParked } from './relay';
import { openSession, parseSessionKey, readSessionFile, SessionFileError } from './session-crypto';
import { describeError, isSessionDead, MtcuteTelegram, type MtcuteClient } from './telegram';

/** What starting needs from mtcute's `TelegramClient` on top of the relay's part. */
export interface BootClient extends MtcuteClient {
  importSession(session: string): Promise<void>;
  getMe(): Promise<{ readonly id: number; readonly raw: tl.RawUser }>;
  notifyLoggedIn(user: tl.RawUser): Promise<unknown>;
  startUpdatesLoop(): Promise<void>;
  destroy(): Promise<void>;
}

export type Started =
  { kind: 'running'; relay: HumoRelay; client: BootClient } | { kind: 'parked'; reason: string };

/**
 * Start the userbot: open the sealed session, check it with Telegram, start mtcute's updates, then
 * the relay (which catches up before its first heartbeat). A missing or unreadable session file, or a
 * session Telegram no longer accepts, parks it: one error line, no heartbeats, no restart loop.
 */
export async function startUserbot(o: {
  env: Env;
  log: Logger;
  api: FeedApi;
  createClient: () => BootClient;
  /** Parked, at start or later: the process must stay up idle (a restart loop would hammer Telegram). */
  onParked?: (reason: string) => void;
}): Promise<Started> {
  const { env, log } = o;
  const park = (reason: string): Started => {
    logParked(log, reason);
    o.onParked?.(reason);
    return { kind: 'parked', reason };
  };

  let session: string;
  try {
    const sealed = await readSessionFile(env.USERBOT_SESSION_FILE);
    session = openSession(sealed, parseSessionKey(env.USERBOT_SESSION_KEY));
  } catch (e) {
    if (e instanceof SessionFileError) return park(e.message);
    throw e;
  }

  const client = o.createClient();
  try {
    await client.importSession(session);
    const me = await client.getMe();
    await client.notifyLoggedIn(me.raw);
  } catch (e) {
    // Never let closing a dead client turn a park into a crash (and a Compose restart loop).
    await client.destroy().catch(() => undefined);
    if (isSessionDead(e)) {
      return park(
        `Telegram no longer accepts this session (${describeError(e)}): log in again (docs/run-guide.md → Userbot)`,
      );
    }
    throw e;
  }
  await client.startUpdatesLoop();

  const relay = new HumoRelay({
    telegram: new MtcuteTelegram(client),
    api: o.api,
    log,
    listenChatId: env.USERBOT_LISTEN_CHAT_ID,
    requireVerifiedBot: env.USERBOT_REQUIRE_VERIFIED,
    // Parked: stop talking to Telegram at all until a person logs in again.
    onParked: (reason) => {
      void client.destroy().catch(() => undefined);
      o.onParked?.(reason);
    },
  });
  log.info({ listenChatId: env.USERBOT_LISTEN_CHAT_ID }, 'userbot connected; catching up');
  await relay.start();
  return relay.status === 'parked'
    ? { kind: 'parked', reason: relay.parkReason ?? 'parked' }
    : { kind: 'running', relay, client };
}

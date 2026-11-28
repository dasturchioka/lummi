import {
  INTERNAL_SECRET_HEADER,
  internalContract,
  type HumoMessageResult,
  type UserbotForwardTarget,
} from '@lummi/contracts';
import { initClient } from '@ts-rest/core';

/**
 * The API's internal endpoints (ADR 0014, ADR 0031): the userbot only calls these and never touches
 * the database. Every call carries the shared secret and gives up after `timeoutMs`, so a hung API
 * cannot hang the relay; the caller decides whether to retry.
 */
export interface FeedApi {
  /** The highest stored Humo message id: catch-up resumes after it. Null before the first. */
  lastMessageId(): Promise<number | null>;
  /** Post one message of the Humo chat as received; idempotent on `messageId` (ticket #13). */
  postMessage(messageId: number, text: string): Promise<HumoMessageResult>;
  /** "Alive and caught up" (#36): sent only when every missed message has been posted. */
  heartbeat(): Promise<void>;
  /** Where ➕ notifications are forwarded: the orders group and its «Поступления» topic. */
  forwardTarget(): Promise<UserbotForwardTarget>;
}

/** A refused or failed call. The message names the endpoint and the status, never a body. */
export class FeedApiError extends Error {
  override name = 'FeedApiError';
  constructor(
    readonly endpoint: string,
    readonly status: number | null,
  ) {
    super(status === null ? `${endpoint}: API unreachable` : `${endpoint}: API answered ${status}`);
  }
}

export function createFeedApi(opts: {
  baseUrl: string;
  secret: string;
  timeoutMs?: number;
}): FeedApi {
  const client = initClient(internalContract, {
    baseUrl: opts.baseUrl.replace(/\/$/, ''),
    baseHeaders: { [INTERNAL_SECRET_HEADER]: opts.secret },
    validateResponse: true,
  });
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const fetchOptions = () => ({ signal: AbortSignal.timeout(timeoutMs) });

  /** Run a call; anything but a 200 (or no answer at all) is a FeedApiError. */
  async function call<B>(
    endpoint: string,
    run: () => Promise<{ status: number; body: unknown }>,
  ): Promise<B> {
    let res: { status: number; body: unknown };
    try {
      res = await run();
    } catch {
      // Network error, timeout or an answer that fails the contract; its message adds nothing safe.
      throw new FeedApiError(endpoint, null);
    }
    if (res.status !== 200) throw new FeedApiError(endpoint, res.status);
    return res.body as B;
  }

  return {
    async lastMessageId() {
      const body = await call<{ messageId: number | null }>('last-message-id', () =>
        client.humoLastMessageId({ fetchOptions: fetchOptions() }),
      );
      return body.messageId;
    },
    postMessage(messageId, text) {
      return call<HumoMessageResult>('humo-message', () =>
        client.humoMessage({ body: { messageId, text }, fetchOptions: fetchOptions() }),
      );
    },
    async heartbeat() {
      await call('heartbeat', () =>
        client.userbotHeartbeat({ body: {}, fetchOptions: fetchOptions() }),
      );
    },
    forwardTarget() {
      return call<UserbotForwardTarget>('forward-target', () =>
        client.userbotForwardTarget({ fetchOptions: fetchOptions() }),
      );
    },
  };
}

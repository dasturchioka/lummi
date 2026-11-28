import type { HumoMessageResult, UserbotForwardTarget } from '@lummi/contracts';
import { FeedApiError, type FeedApi } from '../../src/feed-api';

/**
 * The API's internal endpoints as #13 built them: a ➖ debit is not stored, everything else is,
 * idempotent on the message id; the last message id is the highest stored one.
 */
export class FakeFeedApi implements FeedApi {
  readonly stored = new Map<number, string>();
  /** Every post attempt, accepted or not, by message id. */
  readonly attempts: number[] = [];
  /** Fail the next N post attempts with this status (null: unreachable). */
  failPosts = 0;
  failStatus: number | null = 500;
  /** Every call fails as unreachable. */
  down = false;
  target: UserbotForwardTarget = { chatId: -1001234567890, topicId: 3 };
  heartbeats = 0;

  constructor(private readonly events: string[] = []) {}

  private check(endpoint: string): void {
    if (this.down) throw new FeedApiError(endpoint, null);
  }

  async lastMessageId(): Promise<number | null> {
    this.check('last-message-id');
    const ids = [...this.stored.keys()];
    return ids.length ? Math.max(...ids) : null;
  }

  async postMessage(messageId: number, text: string): Promise<HumoMessageResult> {
    this.attempts.push(messageId);
    this.check('humo-message');
    if (this.failPosts > 0) {
      this.failPosts--;
      throw new FeedApiError('humo-message', this.failStatus);
    }
    this.events.push(`post ${messageId}`);
    if (text.includes('➖')) return { outcome: 'debit', duplicate: false, creditId: null };
    const duplicate = this.stored.has(messageId);
    this.stored.set(messageId, text);
    if (text.includes('➕')) return { outcome: 'credit', duplicate, creditId: messageId };
    // the API's rule (#51): no card mask and no digits is the Humo bot's own talk
    return /\*\d{4}|\d/.test(text)
      ? { outcome: 'unparseable', duplicate, creditId: null }
      : { outcome: 'service', duplicate, creditId: null };
  }

  async heartbeat(): Promise<void> {
    this.check('heartbeat');
    this.heartbeats++;
    this.events.push('beat');
  }

  async forwardTarget(): Promise<UserbotForwardTarget> {
    this.check('forward-target');
    return this.target;
  }
}

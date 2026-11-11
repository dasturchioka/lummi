import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OutboxService } from '../src/outbox/outbox.service';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Each test starts from `reset()`, which truncates every table and restarts every id. The queues
 * live in Redis and survive it, so `reset()` must also wait for the jobs still running and drop
 * the queued ones: a job left from one test would otherwise run in the next against rows that
 * now carry the same ids (an outbox row, an order card), or keep its job id and stop the next
 * test's row of that id from being queued at all (#37 review).
 */
let t: TestApp;
let redis: Redis;
let queue: Queue;
beforeAll(async () => {
  t = await createTestApp();
  t.startWorker();
  redis = new Redis(t.env.REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue(t.env.OUTBOX_QUEUE, { connection: redis });
});
afterAll(async () => {
  t.edges.telegram.releaseHeld();
  await queue.close();
  redis.disconnect();
  await t.close();
});

const say = (text: string) =>
  t.app
    .get(OutboxService)
    .withTx((tx) => t.app.get(OutboxService).enqueue(tx, { chatId: 41, text }));

describe('reset() between tests', () => {
  it('waits for a delivery still running before it truncates', async () => {
    await t.reset();
    t.edges.telegram.reset();
    t.edges.telegram.holdSends = true;
    await say('from the test before');
    await vi.waitFor(() => expect(t.edges.telegram.heldSends).toHaveLength(1));

    const order: string[] = [];
    const resetting = t.reset().then(() => order.push('reset'));
    // a reset that does not wait is long done by now
    await new Promise((r) => setTimeout(r, 2_000));
    order.push('landed');
    t.edges.telegram.holdSends = false;
    t.edges.telegram.heldSends.splice(0)[0]!.land();
    await resetting;
    expect(order).toEqual(['landed', 'reset']);
  });

  it('drops queued work, so the next test’s row with the same id is delivered at once', async () => {
    await t.reset();
    t.edges.telegram.reset();
    // a delivery from the test before, waiting for its retry
    await queue.add('send', { id: 1 }, { jobId: 'outbox-1', delay: 60_000 });
    await t.reset();
    expect(await queue.getJobCounts('active', 'waiting', 'delayed')).toEqual({
      active: 0,
      waiting: 0,
      delayed: 0,
    });
    // this test's first row has id 1 again: it is queued and sent, not shadowed by the old job
    await say('this test');
    await vi.waitFor(
      () => expect(t.edges.telegram.sent.map((m) => m.text)).toEqual(['this test']),
      {
        timeout: 5_000,
      },
    );
  });
});

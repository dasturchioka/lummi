import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFeedApi, FeedApiError } from '../src/feed-api';

/**
 * The HTTP client of the internal endpoints, against a stand-in API on a local port: the path, the
 * secret header and the error mapping. The endpoints themselves are tested in the API (#13).
 */

const SECRET = 'internal-secret-internal-secret-0123456789';
interface Seen {
  method: string;
  url: string;
  secret: string | undefined;
  body: unknown;
}
const seen: Seen[] = [];
let answer: (req: Seen) => { status: number; body?: unknown; hang?: boolean };
let server: Server;
let baseUrl: string;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const s: Seen = {
      method: req.method!,
      url: req.url!,
      secret: req.headers['x-internal-secret'] as string | undefined,
      body: await readBody(req),
    };
    seen.push(s);
    const a = answer(s);
    if (a.hang) return; // never answers
    res.writeHead(a.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(a.body ?? {}));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  seen.length = 0;
});

const api = (timeoutMs = 2000) =>
  createFeedApi({ baseUrl: `${baseUrl}/`, secret: SECRET, timeoutMs });

describe('FeedApi', () => {
  it('calls the four internal endpoints with the shared secret', async () => {
    answer = (r) =>
      r.url === '/internal/humo/last-message-id'
        ? { status: 200, body: { messageId: 41 } }
        : r.url === '/internal/humo/messages'
          ? { status: 200, body: { outcome: 'credit', duplicate: false, creditId: 7 } }
          : r.url === '/internal/userbot/forward-target'
            ? { status: 200, body: { chatId: -1001, topicId: 3 } }
            : { status: 200, body: { ok: true } };

    expect(await api().lastMessageId()).toBe(41);
    expect(await api().postMessage(42, '➕ 1 UZS')).toEqual({
      outcome: 'credit',
      duplicate: false,
      creditId: 7,
    });
    await api().heartbeat();
    expect(await api().forwardTarget()).toEqual({ chatId: -1001, topicId: 3 });

    expect(seen.map((s) => [s.method, s.url, s.secret])).toEqual([
      ['GET', '/internal/humo/last-message-id', SECRET],
      ['POST', '/internal/humo/messages', SECRET],
      ['POST', '/internal/userbot/heartbeat', SECRET],
      ['GET', '/internal/userbot/forward-target', SECRET],
    ]);
    expect(seen[1]!.body).toEqual({ messageId: 42, text: '➕ 1 UZS' });
  });

  it('turns a refusal, an answer off the contract and silence into FeedApiError without the text', async () => {
    const text = '➕ 75.750,00 UZS secret-ish text';
    for (const [reply, status] of [
      [{ status: 401, body: { code: 'unauthorized' } }, 401],
      [{ status: 500, body: { message: 'boom' } }, 500],
      [{ status: 200, body: { unexpected: true } }, null],
      [{ status: 200, hang: true }, null],
    ] as const) {
      answer = () => reply;
      const error = await api(300)
        .postMessage(1, text)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(FeedApiError);
      expect((error as FeedApiError).status).toBe(status);
      expect(String(error)).not.toContain('75.750');
    }
  });

  it('a closed port is "unreachable"', async () => {
    const dead = createFeedApi({ baseUrl: 'http://127.0.0.1:1', secret: SECRET, timeoutMs: 1000 });
    await expect(dead.heartbeat()).rejects.toMatchObject({ name: 'FeedApiError', status: null });
  });
});

import { expect, it, vi } from 'vitest';
import { buildUrl, createClient, type Sender } from './client';

it('builds urls with path params and a query string', () => {
  expect(
    buildUrl('/api', '/orders/:id', { id: 'a b' }, { page: 2, tag: ['x', 'y'], skip: undefined }),
  ).toBe('/api/orders/a%20b?page=2&tag=x&tag=y');
  expect(() => buildUrl('/api', '/orders/:id')).toThrow('missing path param');
});

it('calls the route of the contract with JSON, extra headers and parses the answer', async () => {
  const send = vi.fn(
    async (_req: Parameters<Sender>[0]) =>
      new Response(JSON.stringify({ code: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = createClient('/api', send);
  const res = await client.auth.telegram({ body: { initData: 'x' } });
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ code: 'unauthorized' });
  expect(send).toHaveBeenCalledWith({
    url: '/api/auth/telegram',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"initData":"x"}',
  });
  await client.auth.refresh({ extraHeaders: { authorization: 'Bearer t' } });
  expect(send.mock.calls[1]?.[0]).toMatchObject({
    url: '/api/auth/refresh',
    headers: { authorization: 'Bearer t' },
  });
});

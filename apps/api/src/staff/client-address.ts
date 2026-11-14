import type { Request } from 'express';

/**
 * The address a sign-in came from, for the per-address lock (ADR 0038). In a deploy only Caddy
 * reaches the API, and it sets `X-Real-IP` to the client it resolved through its trusted proxies
 * (deploy/Caddyfile), overwriting whatever the client sent. In development the Next proxy adds
 * `X-Forwarded-For`, whose last entry is the hop next to us. Otherwise, the socket's peer.
 */
export function clientAddress(req: Request): string {
  const real = req.headers['x-real-ip'];
  const forwarded = req.headers['x-forwarded-for'];
  const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
  const raw = (typeof real === 'string' && real.trim()) || last || req.socket.remoteAddress || '';
  // a dual-stack socket reports IPv4 peers as ::ffff:a.b.c.d
  const address = raw.toLowerCase().startsWith('::ffff:') ? raw.slice(7) : raw;
  return address.slice(0, 64) || 'unknown';
}

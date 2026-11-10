import type { IncomingMessage } from 'node:http';

/**
 * The request body, read only once the route has accepted the request (after the session guard),
 * and only up to `maxBytes`: past it, null, and the rest is read and dropped, never kept, so the
 * answer reaches the client however much it sends. A declared length over the bound is refused
 * before a byte is read.
 */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    // another parser already read it (a JSON or image content type): nothing more will come
    if (req.readableEnded) {
      resolve(Buffer.alloc(0));
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks, size));
    });
    req.on('error', reject);
  });
}

import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Dev proxy: the browser only ever talks to this origin, so the session cookie is same-origin.
// At deploy, Caddy does the same job: `admin.<domain>/api/*` -> API (prefix stripped), ADR 0027.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';

const config: NextConfig = {
  // The Docker image runs the standalone server; the trace root is the repo so workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  transpilePackages: ['@lummi/contracts', '@lummi/i18n', '@lummi/rich-text'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};
export default config;

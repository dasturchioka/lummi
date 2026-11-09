import type { NextConfig } from 'next';

// Dev proxy: the browser only ever talks to this origin, so the session cookie is same-origin.
// At deploy, Caddy does the same job: `admin.<domain>/api/*` -> API (prefix stripped), ADR 0027.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';

const config: NextConfig = {
  transpilePackages: ['@lummi/contracts', '@lummi/i18n'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};
export default config;

# Mini App shell: same-origin `/api`, session in memory, browser mode for development

- **API on the same origin.** The Mini App calls `/api/*`. Vite proxies it in development and Caddy in production, stripping the prefix, so the API needs no CORS (the admin already works this way, ADR 0027).
- **The session token lives in memory only.** It is short-lived (ADR 0029) and Telegram hands the app fresh `initData` on every launch, so nothing needs persisting. A per-device hint (language and theme, in `localStorage`) only prevents a wrong first paint; the server is the source of truth.
- **Browser mode.** Outside Telegram the app reads launch params from the URL hash and runs the SDK's mock environment, but only in the dev server or a build with `VITE_BROWSER_MODE=1`. It is no way around authentication: the API still verifies the `initData` signature.
- **Theme.** Tokens are CSS variables in one file (`apps/miniapp/src/styles/tokens.css`), swapped by `html[data-theme]`, wired into Tailwind v4 as semantic roles (`bg-ground`, `text-ink`). Components never use hex values.
- **Bundle budget.** `apps/miniapp/scripts/check-bundle-size.mjs` reads the Vite manifest and fails CI above 150 KB gzip of initial JS.

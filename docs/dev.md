# Developing LUMMI locally

Node 24+ and Docker are required. Several agents or branches may run on one machine, so **every port is an env variable**; never rely on a default being free.

| What | Env var | Default | Ticket-N convention |
|---|---|---|---|
| API | `API_PORT` | 4000 | `41NN` |
| Postgres (host port) | `POSTGRES_HOST_PORT` | 5432 | `25NN` |
| Redis (later) | `REDIS_HOST_PORT` | 6379 | `26NN` |
| Mini App | `MINIAPP_PORT` | 5173 | `51NN` |
| Admin (later) | `ADMIN_PORT` | | `61NN` |

## Install

```sh
npm install
cp .env.example .env.local     # git-ignored; set BOT_TOKEN, SESSION_SECRET, ports
```

`.env` (secrets, shared) and `.env.local` (yours) are both loaded by the API and the migration command; real shell variables win over both. Only `.env.example` is committed.

## Run the API against a local Postgres

```sh
POSTGRES_HOST_PORT=2502 docker compose -f docker-compose.dev.yml -p lummi-2 up -d --wait   # or: npm run db:up
export DATABASE_URL=postgres://lummi:lummi@127.0.0.1:2502/lummi
npm run db:migrate
API_PORT=4102 npm run dev:api
docker compose -f docker-compose.dev.yml -p lummi-2 down -v                                  # when done
```

Pass `-p <name>` (compose project) when two stacks share a machine, so containers and volumes do not collide.

## Mini App (`apps/miniapp`)

```sh
API_PORT=4103 npm run dev:api            # the API, as above
MINIAPP_PORT=5103 API_PORT=4103 npm run dev -w @lummi/miniapp
```

The browser only talks to `/api/*` on its own origin. Vite proxies that to `http://127.0.0.1:$API_PORT` and strips `/api` (production: Caddy does the same, so there is no CORS). Set `VITE_API_URL` to bypass the proxy.

**In a plain desktop browser** (development, screenshots) there is no Telegram. Open the app with Telegram launch params in the URL hash and the SDK's mock environment takes over (dev server only, or a build with `VITE_BROWSER_MODE=1`):

```
http://127.0.0.1:5103/profile#tgWebAppData=<urlencoded initData>&tgWebAppVersion=8.0&tgWebAppPlatform=android&tgWebAppThemeParams={}
```

`initData` must be signed with the dev `BOT_TOKEN` (the API verifies it for real; `apps/miniapp/shots/api.ts` has `signInitData`). Add `tgWebAppStartParam=orders` to test a `startapp` link. The app sets `data-ready="1"` on `<html>` when the saved preferences are applied and fonts are loaded.

**On a phone (dev bot, ADR 0023).** Telegram opens Mini Apps only over HTTPS, so use a named Cloudflare Tunnel on Sardor's account: `cloudflared tunnel run lummi-dev` with a hostname such as `dev.<domain>` pointing at `http://127.0.0.1:$MINIAPP_PORT` (add `server.allowedHosts` in `vite.config.ts` if Vite refuses the host). In BotFather: `/mybots` > `@lummi_dev_bot` > Bot Settings > Menu Button > set the URL to that hostname. Open the bot and tap the menu button. Staging and production use their own bot and domain.

### Screenshots

```sh
npm run shots -w @lummi/miniapp -- --out <dir> [--only home,profile]
```

Captures every screen in `apps/miniapp/shots/registry.ts` at 390x844 (deviceScaleFactor 2), light and dark x RU and UZ, as `<screen>-<theme>-<lang>.png` in `<dir>`. It needs `BOT_TOKEN` (from `.env`). Services already running on `API_PORT`, `MINIAPP_PORT` and `POSTGRES_HOST_PORT` are used as they are; whatever is missing is started (dev Postgres through compose project `lummi-shots`, migrations, API, Vite) and stopped at the end. Theme and language are saved through `PATCH /me/preferences` as the screenshot customer, then each page opens with launch params in the URL, so the app runs through its real sign-in. First run: `npx playwright install chromium`.

To add a screen, append to `registry.ts`: `{ id, path, setup?, initDataAgeSeconds?, fullPage? }`. `setup({ api })` runs before the capture with a client signed in as the screenshot customer (for example, add to the cart first). The run waits for `html[data-ready]`, for every `[data-skeleton]` to disappear (use the `Skeleton` component for loading states) and for fonts.

### Bundle budget

`npm run build -w @lummi/miniapp && npm run size -w @lummi/miniapp` fails above 150 KB gzip of initial JS (entry chunk and its static imports; lazy route chunks do not count). CI runs both. Load screens with `lazyRouteComponent` and keep heavy libraries (Radix Dialog is only in `Sheet`) off the entry path.

## Migrations

Edit `packages/db/src/schema.ts`, then `npm run db:generate` (writes SQL to `packages/db/drizzle/`, commit it) and `npm run db:migrate`. Keys are `bigint identity`, money is `integer` so'm.

## Tests

- Everything, the same as CI: `npx turbo run lint typecheck test`
- One workspace: `npm test -w @lummi/api` (also `typecheck`, `lint`)
- **One test file**: `npm test -w @lummi/api -- test/auth.int.test.ts` (any vitest filter or `-t "name"` works)
- Only fast tests (no Docker): `npm run test:unit -w @lummi/api`; only DB tests: `npm run test:int -w @lummi/api`

API tests come in two projects: `*.unit.test.ts` (no I/O) and `*.int.test.ts` (Seam 1, ADR 0028). The integration project starts **one** Postgres container per run (tmpfs, `fsync=off`, 32 MB buffers), migrates a template database once, and every test file clones its own database from it (`createTestApp()` in `apps/api/test/harness/test-app.ts`). Inside a file call `t.reset()` in `beforeEach` to truncate all tables. `t.signIn(user)` signs `initData` with the test bot token and returns a session-bound client; `t.edges` holds the fakes (`clock`, `telegram`, `receiptJudge`, `files`). To skip the container, set `TEST_DATABASE_URL` to an admin URL of a running Postgres (it needs `CREATE DATABASE` rights); only the template and per-file `t_*` databases are created and dropped.

## Hooks for later tickets

- New app: add `apps/<name>` with `lint`, `typecheck`, `test` scripts and its own port env var; turbo picks it up.
- Mini App, admin, bot, worker: add a `dev:<name>` script at the root and a row in the port table.
- Seed: add `packages/db/src/seed.ts` and a `db:seed` script next to `db:migrate`.
- Redis: add a service to `docker-compose.dev.yml` with `${REDIS_HOST_PORT:-6379}`.

# Developing LUMMI locally

Running it on a server (staging, production): `run-guide.md`.

Node 24+ and Docker are required. Several agents or branches may run on one machine, so **every port is an env variable**; never rely on a default being free.

| What | Env var | Default | Ticket-N convention |
|---|---|---|---|
| API | `API_PORT` | 4000 | `41NN` |
| Postgres (host port) | `POSTGRES_HOST_PORT` | 5432 | `25NN` |
| Redis | `REDIS_HOST_PORT` | 6379 | `26NN` |
| Mini App | `MINIAPP_PORT` | 5173 | `51NN` |
| Admin | `ADMIN_PORT` | 6000 | `61NN` |

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

**Component gallery** (dev server only): `/dev/ui` shows every base component in every state (pressed, disabled, loading, skeleton, empty, error), the type roles with the Uzbek `oʻ gʻ` glyphs, and the colour roles; `/dev/sheet` opens the sheet. Both are in the screenshot run (`ui-gallery`, `ui-sheet`). Add a new base component there with its states. The routes exist only under `import.meta.env.DEV`, and `npm run size` fails if the gallery reaches `dist`.

### Bundle budget

`npm run build -w @lummi/miniapp && npm run size -w @lummi/miniapp` fails above 150 KB gzip of initial JS (entry chunk and its static imports; lazy route chunks do not count). CI runs both. Load screens with `lazyRouteComponent` and keep heavy libraries (Radix Dialog is only in `Sheet`) off the entry path.

### Catalog and photos

The content texts (Home slogan and the six info pages, as drafts) are seeded by the API itself at start (`seedContent` in `main.ts`): idempotent, they never overwrite what the owner edited, so there is no `seed:*` command for them. Delete a row to get its seed text back.

`npm run seed:catalog` (needs `DATABASE_URL`, `FILES_DIR`) loads the 67 fragrances with placeholder prices and renders their photos into `FILES_DIR/public/` (about a minute the first time; idempotent). The API serves them at `/media/public/<hash>-<400|800|1200>.webp` for development; the Mini App reads `VITE_MEDIA_URL` (default `/api/media/public`). Share links use `VITE_BOT_LINK` (default `https://t.me/Lummiuz_bot`; set the dev bot's link locally). The screenshot run seeds the catalog itself when it starts the stack; for a stack that is already running, seed it first.

## Migrations

Edit `packages/db/src/schema.ts`, then `npm run db:generate` (writes SQL to `packages/db/drizzle/`, commit it) and `npm run db:migrate`. Keys are `bigint identity`, money is `integer` so'm.

## Tests

- Everything, the same as CI: `npx turbo run lint typecheck test`
- One workspace: `npm test -w @lummi/api` (also `typecheck`, `lint`)
- **One test file**: `npm test -w @lummi/api -- test/auth.int.test.ts` (any vitest filter or `-t "name"` works)
- Only fast tests (no Docker): `npm run test:unit -w @lummi/api`; only DB tests: `npm run test:int -w @lummi/api`

API tests come in two projects: `*.unit.test.ts` (no I/O) and `*.int.test.ts` (Seam 1, ADR 0028). The integration project starts **one** Postgres container per run (tmpfs, `fsync=off`, 32 MB buffers), migrates a template database once, and every test file clones its own database from it (`createTestApp()` in `apps/api/test/harness/test-app.ts`). Inside a file call `t.reset()` in `beforeEach` to truncate all tables. `t.signIn(user)` signs `initData` with the test bot token and returns a session-bound client; `t.edges` holds the fakes (`clock`, `telegram`, `receiptJudge`, `files`). To skip the container, set `TEST_DATABASE_URL` to an admin URL of a running Postgres (it needs `CREATE DATABASE` rights); only the template and per-file `t_*` databases are created and dropped.

## Bot and worker

- The bot is a module of the API. `BOT_MODE=polling` long-polls (one process per token, so run it briefly), `webhook` calls `setWebhook` at boot (needs `WEBHOOK_URL`, `WEBHOOK_SECRET`), `off` (default) does nothing; the webhook route `POST /telegram/webhook` always checks the secret header. `MINIAPP_URL` is the `web_app` button and menu button target (a tunnel hostname locally).
- The worker is a separate process: `REDIS_HOST_PORT=2604 docker compose -f docker-compose.dev.yml -p lummi-4 up -d --wait redis`, then `REDIS_URL=redis://127.0.0.1:2604 npm run dev:worker -w @lummi/api`. The API also needs Redis now (same `REDIS_URL`, same `OUTBOX_QUEUE`): after a commit it queues the new rows at once; every minute `tick()` runs registered sweeps and queues whatever is still pending. The worker is the same Nest modules as an application context.
- Producing a message: use `OutboxService.withTx(tx => …)` and inside it `enqueue(tx, {chatId, text, threadId?, options?})` or `AlertService.alertOwner(tx, text)`. A sweep registers with `WorkerRuntime.register({name, run(ctx)})` and stamps its marker and enqueues inside one `ctx.withTx`.
- Group chat id, topic ids and alert recipients are settings (`bot.groupChatId`, `bot.topics`, `bot.alertRecipients`).
- Tests: one Testcontainers Redis per run (`TEST_REDIS_URL` reuses a running one). `t.postUpdate(json)` posts to the webhook; `t.startWorker()` gives a worker whose sends land on `t.edges.telegram`.

## Admin panel

`apps/admin` (Next.js, shadcn/ui on brand tokens). Seed the first owner, run the API with the dev sign-in, then the panel:

```sh
npm run seed:owner -- --telegram-id <your id> --name "<name>"      # idempotent
ADMIN_DEV_LOGIN=true API_PORT=4106 npm run dev:api
API_URL=http://127.0.0.1:4106 NEXT_PUBLIC_ADMIN_DEV_LOGIN=true ADMIN_PORT=6106 npm run dev:admin
```

`/api/*` is proxied to `API_URL` with the prefix stripped (Caddy does it at deploy). The real Login Widget needs `NEXT_PUBLIC_BOT_USERNAME` and the page served from the domain set with BotFather `/setdomain` (dev: the Cloudflare tunnel). `ADMIN_DEV_LOGIN=true` signs in by Telegram id with no widget; the API refuses to boot with it when `NODE_ENV=production`.

### Admin screenshots

```sh
API_PORT=4106 ADMIN_PORT=6106 POSTGRES_HOST_PORT=2506 npm run shots -w @lummi/admin -- --out <dir> [--only login,staff]
```

Captures every screen in `apps/admin/shots/screens.ts` at 390 px and 1280 px wide, in RU and UZ (the admin is light only), as `<screen>-<width>-<lang>.png`: `login`, `no-access`, `home`, `home-manager`, `menu` (390 only), `staff`, `staff-add`, `staff-deactivate`, `staff-remove`, `not-found` (inside the panel), `not-found-guest` (signed out). It signs in through the dev path, so an API that is already running must have `ADMIN_DEV_LOGIN=true`; whatever is not running (Postgres as compose project `lummi-admin-shots`, or `SHOTS_COMPOSE_PROJECT` when parallel worktrees each need their own; the API; the admin) is started on the given ports and stopped again at the end. Shot staff (an owner, three managers, one of them switched off) are written through the seed CLI and the staff endpoints under reserved Telegram ids `9900000NN`, so they never collide with real dev accounts. The catalog screens (`catalog-*`) also get worst-case rows next to the 67 seeded fragrances (`shots/catalog-data.ts`: a 40-character name and brand, long RU/UZ texts, seven-digit prices with a markdown, no photo, every flag, a long dictionary entry), written through the admin endpoints. A new admin screen adds an entry to `screens.ts` (`path`, `as: 'owner' | 'manager'`, and an `act` step to open a dialog or submit a form).

Seam 1 helpers: `t.ownerSession()`, `t.managerSession()` (or `t.signInStaff(role, user?, { active })`) insert the staff row, sign in through the real widget path and return `{ staff, cookie, client }`; `t.widgetPayload(user)` builds a signed widget payload. Owner-only endpoints use `@UseGuards(StaffGuard, OwnerGuard)`.

## Humo feed (internal endpoints)

The userbot (ADR 0014) calls the API over `internalContract`, from an allowed network and with the `x-internal-secret` header (ADR 0031). Set `INTERNAL_API_SECRET` (at least 32 characters) in `.env.local`; without it the routes answer 404. `INTERNAL_ALLOWED_CIDRS` defaults to loopback, and a request with `X-Forwarded-For`, `Forwarded` or `X-Real-IP` is always refused.

- `POST /internal/humo/messages` `{messageId, text}` records a ➕ as a credit. A ➖ is ignored and not stored. Anything else is stored raw, flagged, and alerts the owner. A repeated `messageId` changes nothing (`duplicate: true`). The accepted variants are in `docs/spec.md` → Changes 2026-11-09 «Humo credit intake».
- `GET /internal/humo/last-message-id` returns where the userbot resumes after a restart.
- `POST /internal/userbot/heartbeat` `{}` stamps the userbot's last-seen time (the one row of `userbot_heartbeat`).

Try it against a running API:

```sh
curl -s localhost:4113/internal/humo/messages -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H 'content-type: application/json' \
  -d '{"messageId":1,"text":"➕ 75.750,00 UZS\n💳 HUMOCARD *1234\n🕓 20:54 22.06.2025"}'
```

Payment matching subscribes with `CreditEvents.onCreditRecorded(handler)` in a provider's constructor. The handler runs in the worker, not the API, and the event is durable (ADR 0021):

- The credit row is the event, and the API queues it to `EVENTS_QUEUE` right after the commit. The API and the worker must use the same `EVENTS_QUEUE`.
- Broadcasts (#14) queue one job per customer to `BROADCAST_QUEUE` (default `broadcasts`); the API and the worker must use the same one. The send rate is the setting `broadcast.sendRatePerSecond`, read when the worker starts. `BOT_LINK` (https, the bot's `t.me` link) is the base of a broadcast's `startapp` button: required in production, a dev bot link locally.
- The `credit-recorded` sweep queues anything missed.
- The credit is stamped `event_handled_at` once every handler has succeeded. A handler that throws is retried, so handlers must be idempotent.
- Payment matching (#32) checks receipts on `RECEIPT_CHECKS_QUEUE` (default `receipt-checks`, job id `receipt-<id>`); the API queues a check after an upload, the worker after a credit and from the `receipt-matching` sweep, so both must use the same one. Tests script the judge with `t.edges.receiptJudge.respond`, record credits with `recordCredit` and pay an order with `payWithCredit` (`apps/api/test/harness/payments.ts`).

Real Humo messages go in `apps/api/test/fixtures/humo-messages.ts`, and the parser test runs each one.

Logs: an unexpected error is logged only as `describeError()` (`apps/api/src/logging/`), never with its message or stack, because a failed query's message carries its parameters, which hold personal data. Use `describeError(e)` wherever you log, store or alert an error.

## Hooks for later tickets

- New app: add `apps/<name>` with `lint`, `typecheck`, `test` scripts and its own port env var; turbo picks it up.
- Mini App, admin, bot, worker: add a `dev:<name>` script at the root and a row in the port table.
- Seed: add `packages/db/src/seed.ts` and a `db:seed` script next to `db:migrate`.

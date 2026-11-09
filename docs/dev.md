# Developing LUMMI locally

Node 24+ and Docker are required. Several agents or branches may run on one machine, so **every port is an env variable**; never rely on a default being free.

| What | Env var | Default | Ticket-N convention |
|---|---|---|---|
| API | `API_PORT` | 4000 | `41NN` |
| Postgres (host port) | `POSTGRES_HOST_PORT` | 5432 | `25NN` |
| Redis (later) | `REDIS_HOST_PORT` | 6379 | `26NN` |
| Mini App | `MINIAPP_PORT` | | `51NN` |
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

## Migrations

Edit `packages/db/src/schema.ts`, then `npm run db:generate` (writes SQL to `packages/db/drizzle/`, commit it) and `npm run db:migrate`. Keys are `bigint identity`, money is `integer` so'm.

## Tests

- Everything, the same as CI: `npx turbo run lint typecheck test`
- One workspace: `npm test -w @lummi/api` (also `typecheck`, `lint`)
- **One test file**: `npm test -w @lummi/api -- test/auth.int.test.ts` (any vitest filter or `-t "name"` works)
- Only fast tests (no Docker): `npm run test:unit -w @lummi/api`; only DB tests: `npm run test:int -w @lummi/api`

API tests come in two projects: `*.unit.test.ts` (no I/O) and `*.int.test.ts` (Seam 1, ADR 0028). The integration project starts **one** Postgres container per run (tmpfs, `fsync=off`, 32 MB buffers), migrates a template database once, and every test file clones its own database from it (`createTestApp()` in `apps/api/test/harness/test-app.ts`). Inside a file call `t.reset()` in `beforeEach` to truncate all tables. `t.signIn(user)` signs `initData` with the test bot token and returns a session-bound client; `t.edges` holds the fakes (`clock`, `telegram`, `receiptJudge`, `files`). To skip the container, set `TEST_DATABASE_URL` to an admin URL of a running Postgres (it needs `CREATE DATABASE` rights); only the template and per-file `t_*` databases are created and dropped.

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

Captures every screen in `apps/admin/shots/screens.ts` at 390 px and 1280 px wide, in RU and UZ (the admin is light only), as `<screen>-<width>-<lang>.png`: `login`, `no-access`, `home`, `home-manager`, `menu` (390 only), `staff`, `staff-add`, `staff-deactivate`, `staff-remove`, `not-found`. It signs in through the dev path, so an API that is already running must have `ADMIN_DEV_LOGIN=true`; whatever is not running (Postgres as compose project `lummi-admin-shots`, the API, the admin) is started on the given ports and stopped again at the end. Shot staff (an owner, three managers, one of them switched off) are written through the seed CLI and the staff endpoints under reserved Telegram ids `9900000NN`, so they never collide with real dev accounts. A new admin screen adds an entry to `screens.ts` (`path`, `as: 'owner' | 'manager'`, and an `act` step to open a dialog or submit a form).

Seam 1 helpers: `t.ownerSession()`, `t.managerSession()` (or `t.signInStaff(role, user?, { active })`) insert the staff row, sign in through the real widget path and return `{ staff, cookie, client }`; `t.widgetPayload(user)` builds a signed widget payload. Owner-only endpoints use `@UseGuards(StaffGuard, OwnerGuard)`.

## Hooks for later tickets

- New app: add `apps/<name>` with `lint`, `typecheck`, `test` scripts and its own port env var; turbo picks it up.
- Mini App, admin, bot, worker: add a `dev:<name>` script at the root and a row in the port table.
- Seed: add `packages/db/src/seed.ts` and a `db:seed` script next to `db:migrate`.
- Redis: add a service to `docker-compose.dev.yml` with `${REDIS_HOST_PORT:-6379}`.

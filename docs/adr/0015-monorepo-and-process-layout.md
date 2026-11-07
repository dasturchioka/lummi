# One npm-workspaces monorepo; the bot lives inside the API; the userbot is a separate process

One repo with **npm workspaces + Turborepo** (pnpm rejected by the team):

```
apps/
  miniapp/    React + Vite
  admin/      Next.js
  api/        NestJS: HTTP API, bot, workers
  userbot/    mtcute, listens only to the Humo chat, forwards ➕ and posts raw text to the API
packages/
  contracts/  zod schemas + API contract (Quote, DTOs, enums); types only, no pricing logic (ADR 0001)
  db/         schema, migrations, seed
  i18n/       RU/UZ strings shared by miniapp, bot and admin
  config/     tsconfig, eslint, prettier
```

The grammY bot is a module of `apps/api` (its webhook is an API route), not its own app: group buttons, receipt intake and status changes call the domain services directly, so the single order-transition function (ADR 0011) has one entry, not two. `apps/api` builds one image with two entrypoints: `main.ts` (HTTP + bot webhook) and `worker.ts` (queues and schedules: receipt AI, reminders, birthday coupons, review requests, reserve sweep), so a crashed worker never takes down checkout or the payment screen. The userbot runs as its own process so the customer's personal session never shares a process with the API. It doesn't touch the DB: it posts each raw Humo notification (text + `message_id`) to an internal API endpoint (localhost only, shared secret); the API parses it, is the only DB writer, and starts matching at once.

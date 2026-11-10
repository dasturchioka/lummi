# Run guide: staging and production

How the stack runs on a server (ADR 0023, 0024). For local development see `dev.md`. The same `docker-compose.yml` runs staging and production; only the `.env` differs.

## What runs

| Service | Image | Notes |
|---|---|---|
| `caddy` | `lummi-web` (Caddy + Mini App build + `deploy/Caddyfile`) | routes by host; serves the Mini App and `media.` |
| `api` | `lummi-api` | NestJS HTTP + bot webhook, `GET /health` |
| `worker` | `lummi-api` (`src/worker.ts`) | outbox, reserve sweeps, broadcasts |
| `admin` | `lummi-admin` (Next.js standalone) | |
| `postgres`, `redis` | official | no published ports; volumes `pgdata`, `redisdata` |

Hosts, all from `DOMAIN`: `<DOMAIN>` (Mini App; `/api/*` is the API with the prefix stripped), `api.<DOMAIN>` (API, bot webhook `/telegram/webhook`), `admin.<DOMAIN>` (admin; `/api/*` goes to the API so the session cookie is same-origin), `media.<DOMAIN>` (`/media/public/<hash>-<400|800|1200>.webp`, immutable).

- `/media/private` and `..` paths are 404 on every host. Caddy mounts only `public/` of the `files` volume, read-only; receipts live in `private/` of the same volume (ADR 0025).
- `/internal/*` is never routed (ADR 0031). Compose network is pinned to `172.28.0.0/24` and that subnet is in `INTERNAL_ALLOWED_CIDRS`.
- Images: `api` runs TypeScript through `tsx` (the workspace packages export `.ts`; compiling them would need a build per package; cost about 0.5 s start). Non-root, production dependencies only. `lummi-web` is the stock Caddy image (it binds 80/443 as root inside its container).
- Logs: pino JSON on stdout (`LOG_LEVEL`), Docker `json-file` rotation 10 MB x 5 on every service.
- Userbot: no entrypoint exists yet (ticket #13 ships the parser and endpoints only). `docker-compose.yml` has a comment where its service goes, under a `userbot` profile.

## Staging layout (Sardor's shared VPS 185.209.228.62)

- Host nginx owns 80/443 and terminates TLS (one certbot cert for the four hosts), proxying all of them to `127.0.0.1:4180` with `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`. Our Caddy runs `CADDY_SCHEME=http://` (plain HTTP, no ACME) and trusts forwarded headers from private ranges only. The admin cookie is `Secure` because the API runs with `NODE_ENV=production`.
- Deploy dir `/opt/lummi-staging`: `.env` (written by Sardor, `deploy/staging.env.example` lists the keys), `docker-compose.yml` (copied by CI), `.deploy.env` (written by CI: `IMAGE_TAG`, `GHCR_OWNER`; no secrets).
- Compose project `lummi-staging`. Manual commands: `cd /opt/lummi-staging && alias dc='docker compose --env-file .env --env-file .deploy.env'`.
- Compose >= 2.27 is needed (volume `subpath`).
- Host hardening (ufw, fail2ban, unattended-upgrades) is not done here: the host is shared and already set up.

## GitHub settings

| Name | Kind | Purpose |
|---|---|---|
| `STAGING_SSH_HOST` | secret | VPS address |
| `STAGING_SSH_USER` | secret | `lummi-deploy` (docker group, key-only) |
| `STAGING_SSH_KEY` | secret | its private key |
| `STAGING_SSH_KNOWN_HOSTS` | secret | pinned host key; no `StrictHostKeyChecking=no` |
| `STAGING_DOMAIN` | variable | `lummi.dasturchioka.uz`; used by the smoke test |
| `STAGING_BOT_LINK` | variable | `https://t.me/lummi_staging_bot`; the only value baked into a build (Mini App share links, `VITE_BOT_LINK`) |

`GITHUB_TOKEN` pushes images and, piped over SSH, logs the VPS into ghcr.io for the pull; `docker logout` follows. Nothing long-lived is on the VPS. Images stay private.

## Staging `.env` keys

| Key | Meaning |
|---|---|
| `COMPOSE_PROJECT_NAME` | `lummi-staging` |
| `DOMAIN` | base domain of the four hosts |
| `CADDY_SCHEME` | `http://` on staging; empty on production (automatic HTTPS) |
| `CADDY_HTTP_PUBLISH`, `CADDY_HTTPS_PUBLISH` | Caddy host ports; `127.0.0.1:4180:80` on staging, default `80:80` / `443:443` on production |
| `POSTGRES_PASSWORD` | letters and digits only (it sits in a URL) |
| `BOT_TOKEN` | the environment's bot (`@lummi_staging_bot`); signs `initData` |
| `SESSION_SECRET` | 32+ chars |
| `WEBHOOK_SECRET` | `A-Za-z0-9_-`, Telegram echoes it in a header |
| `INTERNAL_API_SECRET` | 32+ chars; shared with the userbot (ADR 0031) |
| `BOT_LINK` | `https://t.me/<bot>`; base of broadcast buttons |
| `ADMIN_BOT_USERNAME` | bot name for the admin Login Widget (no `@`); read at run time |
| `TYPESAFE_API_KEY` | receipt AI (required in production mode) |
| `OPENAI_API_KEY` | optional fallback; may be empty |
| `BOT_MODE`, `LOG_LEVEL` | optional; defaults `webhook`, `info` |

## First deploy (once, by hand)

Put `.env` in place, then push to `stage-1` or run the workflow. The job does steps 1-4 itself on every deploy; run them by hand the first time to see errors:

```sh
cd /opt/lummi-staging && dc='docker compose --env-file .env --env-file .deploy.env'
$dc pull
$dc up -d --wait postgres redis
$dc run --rm api node --import tsx ../../packages/db/src/migrate-cli.ts          # 1. migrations
$dc run --rm api node --import tsx src/cli/seed-staging.ts                        # 2. seed (never overwrites)
$dc up -d --wait                                                                  # 3. start
$dc run --rm api node --import tsx src/cli/bot-setup.ts                           # 4. webhook + menu button
$dc run --rm api node --import tsx src/cli/seed-owner.ts --telegram-id <the customer's id> --name "<name>"   # once, by hand
```

Step 2 loads the 67-fragrance catalog (placeholder prices, photos, Discovery set) only while the catalog is empty, and adds missing BTS points; a second run changes nothing. The 990000001 in the dev seed is a placeholder: use the customer's real Telegram id in `seed-owner`. Step 4 sets the webhook (`https://api.<DOMAIN>/telegram/webhook`, secret, `drop_pending_updates: false`, `message` and `my_chat_member`) and the default menu button (web_app to `https://<DOMAIN>/`); it is idempotent.

## BotFather (cannot be done by API)

- `/setdomain` for the staging bot = `admin.<DOMAIN>` (the admin Login Widget).
- Bot Settings > Configure Mini App > set `https://<DOMAIN>/` as the bot's main Mini App (needed for `?startapp=` links).

## Production (customer's dedicated VPS)

Same Compose file: `CADDY_SCHEME` empty, no `CADDY_*_PUBLISH` lines, DNS for the four hosts pointing at the server, ports 80/443 free. Caddy gets certificates itself. Deploys come from `v*` tags only (not wired yet; it needs the customer's SSH secrets).

Host setup, Ubuntu 24.04 LTS:

```sh
# as root, once
adduser --disabled-password lummi-deploy && usermod -aG docker lummi-deploy
install -d -m 700 -o lummi-deploy /home/lummi-deploy/.ssh        # put the deploy public key in authorized_keys
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh
apt-get install -y ufw fail2ban unattended-upgrades
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
systemctl enable --now fail2ban
dpkg-reconfigure -plow unattended-upgrades
install -d -o lummi-deploy /opt/lummi
```

Data stays in Uzbekistan (ADR 0020): backups of `pgdata` and `files` go to storage on the same server or elsewhere in the country, never abroad.

## Local check of the production stack

`docker compose --env-file <env> config` validates it. To try it on a laptop, build the three images (`docker build --target api|admin|web .`, one at a time), tag them `ghcr.io/<owner>/lummi-<name>:<IMAGE_TAG>`, set `DOMAIN=lummi.localhost`, and `curl --resolve` or send `Host:` headers to the Caddy port.

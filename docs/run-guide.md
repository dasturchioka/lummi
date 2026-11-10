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

Hosts, all from `DOMAIN`: `<DOMAIN>` (Mini App; `/api/*` is the API with the prefix stripped), `api.<DOMAIN>` (API, bot webhook `/telegram/webhook`), `admin.<DOMAIN>` (admin, not frameable; `/api/*` goes to the API so the session cookie is same-origin; the Mini App host stays frameable because Telegram Web embeds it), `media.<DOMAIN>` (`/media/public/<hash>-<400|800|1200>.webp`, immutable).

- `/media/private` and `..` paths are 404 on every host. Caddy mounts only `public/` of the `files` volume, read-only; receipts live in `private/` of the same volume (ADR 0025).
- `/internal/*` is never routed (ADR 0031). Compose network is pinned to `172.28.0.0/24` and that subnet is in `INTERNAL_ALLOWED_CIDRS`.
- Images: `api` runs TypeScript through `tsx` (the workspace packages export `.ts`; compiling them would need a build per package; cost about 0.5 s start). Non-root, production dependencies only. `lummi-web` is the stock Caddy image (it binds 80/443 as root inside its container).
- Logs: pino JSON on stdout (`LOG_LEVEL`), Docker `json-file` rotation 10 MB x 5 on every service.
- Userbot: no entrypoint exists yet (ticket #13 ships the parser and endpoints only). `docker-compose.yml` has a comment where its service goes, under a `userbot` profile.

## Staging layout (Sardor's shared VPS 185.209.228.62)

- Host nginx owns 80/443 and terminates TLS (one certbot cert for the four hosts), proxying all of them to `127.0.0.1:4180` with `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`. Our Caddy runs `CADDY_SCHEME=http://` (plain HTTP, no ACME) and trusts forwarded headers from private ranges only. The admin cookie is `Secure` because the API runs with `NODE_ENV=production`.
- Deploy dir `/opt/lummi-staging` (owner `lummi-deploy`, mode 700): `.env` (written by Sardor, mode 600; `deploy/staging.env.example` lists the keys), `docker-compose.yml` (copied by CI), `.deploy.env` and `.deploy.env.prev` (written by CI after a successful deploy: `IMAGE_TAG`, `GHCR_OWNER`; no secrets).
- Compose project `lummi-staging`. Manual commands (after one CI deploy has written `.deploy.env`): `cd /opt/lummi-staging && alias dc='docker compose --env-file .env --env-file .deploy.env'`.
- Compose >= 2.27 is needed (volume `subpath`).
- Host hardening (ufw, fail2ban, unattended-upgrades) is not done here: the host is shared and already set up.

## GitHub settings

| Name | Kind | Purpose |
|---|---|---|
| `STAGING_SSH_HOST` | environment secret (`staging`) | VPS address |
| `STAGING_SSH_USER` | environment secret | `lummi-deploy` (docker group, key-only) |
| `STAGING_SSH_KEY` | environment secret | its private key |
| `STAGING_SSH_KNOWN_HOSTS` | environment secret | pinned host key; no `StrictHostKeyChecking=no` |
| `STAGING_DOMAIN` | repository variable | `lummi.dasturchioka.uz`; used by the smoke test |
| `STAGING_BOT_LINK` | repository variable | `https://t.me/<staging bot>`; the only value baked into a build (Mini App share links, `VITE_BOT_LINK`). Empty fails the web image build |

The environment `staging` allows only `stage-1` and `main`; the deploy jobs also check the branch. The `images` job has `packages: write`, `deploy` only `packages: read`. `GITHUB_TOKEN` pushes images and, sent as the first stdin line over SSH (never in argv, so not in `ps`), logs the VPS into ghcr.io for the pull; `docker logout` follows. Nothing long-lived is on the VPS. Images stay private.

## Staging `.env` keys

| Key | Meaning |
|---|---|
| `COMPOSE_PROJECT_NAME` | `lummi-staging` |
| `DOMAIN` | base domain of the four hosts |
| `CADDY_SCHEME` | `http://` on staging; empty on production (automatic HTTPS) |
| `TRUSTED_PROXIES` | the one hop allowed to set `X-Forwarded-*`: the Compose gateway `172.28.0.1/32` on staging (check with `docker network inspect lummi-staging_lummi`); unset on production |
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

## First deploy on a fresh host

Human steps first, in this order:

1. On the VPS, as root: `install -d -o lummi-deploy -g lummi-deploy -m 700 /opt/lummi-staging`.
2. As `lummi-deploy`, write `/opt/lummi-staging/.env` from `deploy/staging.env.example` and `chmod 600` it.
3. Push to `stage-1` (or run the workflow on `stage-1`/`main`). CI copies `docker-compose.yml`, pulls, migrates, seeds, starts, and writes `.deploy.env`. The API sets the Telegram webhook and the default menu button itself when it boots (`BOT_MODE=webhook`; `drop_pending_updates` is false).
4. Add the owner once, by hand (the customer's real Telegram id; the 990000001 in the dev seed is a placeholder):

```sh
cd /opt/lummi-staging && dc='docker compose --env-file .env --env-file .deploy.env'
$dc run --rm -T api node --import tsx src/cli/seed-owner.ts --telegram-id <the customer's id> --name "<name>"
```

The seed step (`src/cli/seed-staging.ts`) loads the 67-fragrance catalog (placeholder prices, photos, Discovery set) only while the catalog is empty, and adds missing BTS points; a second run changes nothing.

Manual commands work only after one CI run (they need `docker-compose.yml` and `.deploy.env`). To run them before that: `scp docker-compose.yml lummi-deploy@<host>:/opt/lummi-staging/`, write `.deploy.env` with `IMAGE_TAG=<commit sha>` and `GHCR_OWNER=<owner>`, and `docker login ghcr.io -u <user>` with a read-only PAT (`read:packages`), then `docker logout ghcr.io` when done. The steps the job runs are:

```sh
$dc pull
$dc up -d --wait postgres redis
$dc run --rm -T api node --import tsx ../../packages/db/src/migrate-cli.ts   # migrations
$dc run --rm -T api node --import tsx src/cli/seed-staging.ts                # seed
$dc up -d --wait
```

## Rollback

`.deploy.env` is rewritten only after migrations and `up -d --wait` succeed; the previous one is kept as `.deploy.env.prev`.

- **The deploy failed before `up -d`** (a failed pull or migration): nothing changed, the old containers keep running. Drizzle applies a migration batch in one transaction, so a failed migration leaves the schema as it was. Fix the cause and push again.
- **The new version started but is bad**: `cp .deploy.env.prev .deploy.env && $dc up -d --wait` returns to the previous images (still on the host). Then revert the commit and push. Migrations are forward-only: an old image runs against the new schema, which is why migrations must stay backward compatible for one release.
- **Redeploy an older SHA**: put its SHA as `IMAGE_TAG` in `.deploy.env`, `docker login` as above, `$dc pull && $dc up -d --wait`.

## BotFather (cannot be done by API)

- `/setdomain` for the staging bot = `admin.<DOMAIN>` (the admin Login Widget).
- Bot Settings > Configure Mini App > set `https://<DOMAIN>/` as the bot's main Mini App (needed for `?startapp=` links).

## Production (customer's dedicated VPS)

Same Compose file: `CADDY_SCHEME` empty (Caddy then also sends HSTS), no `CADDY_*_PUBLISH` or `TRUSTED_PROXIES` lines, DNS for the four hosts pointing at the server, ports 80/443 free. Caddy gets certificates itself. Deploys come from `v*` tags only (not wired yet; it needs the customer's SSH secrets).

Host setup, Ubuntu 24.04 LTS, as root, in this order:

```sh
# 1. A sudo user with your key, BEFORE root login is closed
adduser --disabled-password --gecos '' admin && usermod -aG sudo admin
install -d -m 700 -o admin -g admin /home/admin/.ssh && cp ~/.ssh/authorized_keys /home/admin/.ssh/ && chown admin:admin /home/admin/.ssh/authorized_keys
# (check in a second terminal that `ssh admin@host` works)

# 2. Key-only SSH. A 00- drop-in wins; cloud-init's 50-cloud-init.conf would otherwise re-enable passwords.
printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/00-hardening.conf
sshd -t && systemctl reload ssh
sshd -T | grep -E 'passwordauthentication|permitrootlogin'     # both must say no

# 3. Docker from Docker's apt repository (docs.docker.com/engine/install/ubuntu), then the deploy user
adduser --disabled-password --gecos '' lummi-deploy && usermod -aG docker lummi-deploy
install -d -m 700 -o lummi-deploy -g lummi-deploy /home/lummi-deploy/.ssh     # deploy public key in authorized_keys
install -d -m 700 -o lummi-deploy -g lummi-deploy /opt/lummi

# 4. Firewall, fail2ban, automatic security updates (non-interactive)
apt-get install -y ufw fail2ban unattended-upgrades
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
systemctl enable --now fail2ban
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades
```

`ufw` does not filter ports Docker publishes (Docker writes its own iptables rules). That is safe here only because the stack publishes just Caddy's 80 and 443; Postgres and Redis publish nothing. Keep it that way.

Data stays in Uzbekistan (ADR 0020): backups of `pgdata` and `files` go to storage on the same server or elsewhere in the country, never abroad.

## Local check of the production stack

`docker compose --env-file <env> config` validates it. To try it on a laptop, build the three images (`docker build --target api|admin|web .`, one at a time), tag them `ghcr.io/<owner>/lummi-<name>:<IMAGE_TAG>`, set `DOMAIN=lummi.localhost`, and `curl --resolve` or send `Host:` headers to the Caddy port.

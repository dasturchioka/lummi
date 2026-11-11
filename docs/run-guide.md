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

## Backups and restore

Decision: a **host systemd timer**, not a Compose service (ADR 0035). The restore test must start a throwaway Postgres container, and `rsync` has to read the `files` volume and ssh to the second location. Doing that from a container would mean handing it the Docker socket, which is root on the host. A timer on the host needs only `age`, `rsync` and Docker, and `OnCalendar=... Asia/Tashkent` fixes the time whatever the host's timezone.

What runs every day at 03:00 Asia/Tashkent (`deploy/backup/backup.sh`):

1. `pg_dump -Fc` (compressed) piped straight into `age`, so no plaintext dump touches the disk: `/var/backups/lummi/daily/lummi-<date>.dump.age`. Sunday's dump is copied to `weekly/`. The VPS keeps 14 daily and 8 weekly (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`).
2. The `.env` and the userbot session file, each `age`-encrypted into `secrets/` (both are full access: the session is the customer's own Telegram account).
3. The second copy with `rsync` over ssh to `BACKUP_RSYNC_TARGET`: `dumps/`, `secrets/` and `media/` (the whole files volume, receipts included). Dumps and secrets mirror the VPS (rotation carries over); `media/` is never deleted from the copy, so a purge of a customer's receipts must be repeated there by hand. The target must be inside Uzbekistan (ADR 0025). Until the customer names it, leave it empty: the script warns and skips this step.
4. On any failure the script sends a fixed text to `BACKUP_ALERT_CHAT_ID` through the bot, and exits non-zero (`systemctl status lummi-backup`). A good run writes `/var/backups/lummi/last-success`.

Receipts in `media/` are not encrypted by `age`: they are protected by the ssh channel and the target's own access control, as the live volume is by the host's. The target is the customer's, inside the country.

### Install (once, as root, on the host)

```sh
apt-get install -y age rsync
install -d -m 700 /opt/lummi/backup && cp deploy/backup/{backup.sh,restore.sh,lib.sh} /opt/lummi/backup/
cp deploy/backup/lummi-backup.{service,timer} /etc/systemd/system/
# put the BACKUP_* keys (deploy/staging.env.example) into the stack's .env; the service reads /opt/lummi/.env
systemctl daemon-reload && systemctl enable --now lummi-backup.timer
systemctl start lummi-backup.service && journalctl -u lummi-backup -n 20     # first run by hand
/opt/lummi/backup/backup.sh --dry-run                                         # what the second copy would send
```

Second-copy ssh: create a key for root on the host (`ssh-keygen -t ed25519 -f /root/.ssh/lummi_backup -N ''`), put the public half in the target's `authorized_keys` (ideally restricted to `rsync` in `~/backup`), pin its host key once with `ssh-keyscan -H <host> >> /root/.ssh/known_hosts`, and set `BACKUP_SSH_KEY`.

### The decryption key

The owner generates the key pair on **their own computer**, not on the server: `age-keygen -o lummi-backup-key.txt`. The line `Public key: age1...` goes into `BACKUP_AGE_RECIPIENT`. The file `lummi-backup-key.txt` is the private key: the owner keeps two copies offline (a password manager and a printed or USB copy in a safe place) and it never goes onto the VPS or the second location. **Without it every backup is unreadable and nobody can recover it.** Check it works the day it is made: encrypt a line with the public key, decrypt it with the file.

### Restore, and the monthly restore test

`restore.sh` decrypts a dump into a **throwaway** `postgres:17-alpine` container (no published port, random password), runs `pg_restore`, prints row counts of the key tables and the number of recorded migrations, and deletes the container. It never touches the running stack, so it is also the dry run of a real disaster.

```sh
# the owner gives the key for the test; copy it to a temp file, remove it after
install -m 600 /dev/stdin /root/age-test-key.txt < lummi-backup-key.txt
/opt/lummi/backup/restore.sh --identity /root/age-test-key.txt            # newest daily dump
/opt/lummi/backup/restore.sh --identity /root/age-test-key.txt --dump /var/backups/lummi/weekly/lummi-<date>.dump.age
shred -u /root/age-test-key.txt
```

Monthly (first Monday): run it on production, check the counts look like the shop (orders and customers are not 0 and are close to the admin's numbers), and once a quarter run it against a dump fetched from the **second location**. Note the date and result in the handover log. The container name is printed with `--keep` if you want to look inside; remove it with `docker rm -fv`.

A real disaster, in short: new host from this guide, `docker compose up -d postgres`, create an empty database, `age -d -i key dump.age | docker exec -i <postgres> pg_restore -U lummi -d lummi --no-owner`, restore `media/` into the `files` volume, decrypt `secrets/env.age` to `.env`, then `up -d`.

## Monitoring

- **Error pings.** Every unexpected API 500 and every failed worker sweep is filed in the `error_events` table by a fingerprint (error class, route pattern, top stack frames; no message, no query string, no ids). The first time a fingerprint appears the developer gets one Telegram message; repeats only raise `count` and `last_seen_at`. Set the developer's Telegram id (a number, from the developer's own chat with the bot) in the admin settings (`ops.developerChatId`); until set, the first occurrence only reaches the log. Read the table with `docker compose exec postgres psql -U lummi -c 'select route, error_class, count, last_seen_at from error_events order by last_seen_at desc'`.
- **Worker watch.** The worker stamps `worker_heartbeat` every minute. The API checks it every minute; after `ops.workerSilentMinutes` (default 3) of silence the owner (DMs, «Системные» topic) and the developer get one alert, and one more when it returns. The alert is sent straight to Telegram, since the outbox is delivered by the worker that is down.
- **Uptime monitor (external, every minute).** Use a free pinger such as UptimeRobot (Free: 5-minute interval; the 1-minute interval needs a paid plan) or Better Stack, or a second small VPS in Uzbekistan running a cron `curl`. Two HTTP monitors, 1-minute interval, alert on 2 consecutive failures, notify by Telegram (the monitor's own bot) and e-mail: `https://api.<DOMAIN>/health` (expects 200 `{"status":"ok"}`; 503 means the database is down) and `https://<DOMAIN>/` (the Mini App, expects 200). Create the monitor account in the customer's or the developer's name and write it down in the handover log. It covers the case the API watch cannot: the whole host being down.

## Local check of the production stack

`docker compose --env-file <env> config` validates it. To try it on a laptop, build the three images (`docker build --target api|admin|web .`, one at a time), tag them `ghcr.io/<owner>/lummi-<name>:<IMAGE_TAG>`, set `DOMAIN=lummi.localhost`, and `curl --resolve` or send `Host:` headers to the Caddy port.

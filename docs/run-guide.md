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
| `userbot` | `lummi-userbot` | Humo userbot (ADR 0014, 0035); profile `userbot`, off until someone logs in; volume `userbot-data` |

Hosts, all from `DOMAIN`: `<DOMAIN>` (Mini App; `/api/*` is the API with the prefix stripped), `api.<DOMAIN>` (API, bot webhook `/telegram/webhook`), `admin.<DOMAIN>` (admin, not frameable; `/api/*` goes to the API so the session cookie is same-origin; the Mini App host stays frameable because Telegram Web embeds it), `media.<DOMAIN>` (`/media/public/<hash>-<400|800|1200>.webp`, immutable).

- `/media/private` and `..` paths are 404 on every host. Caddy mounts only `public/` of the `files` volume, read-only; receipts live in `private/` of the same volume (ADR 0025).
- `/internal/*` is never routed (ADR 0031). The Compose network `lummi` is pinned to `172.28.0.0/24`; the userbot's own network `userbot` (only it and the API) to `172.28.1.0/24`, the one subnet in `INTERNAL_ALLOWED_CIDRS`. Both must be free on the host.
- Images: `api` runs TypeScript through `tsx` (the workspace packages export `.ts`; compiling them would need a build per package; cost about 0.5 s start). Non-root, production dependencies only. `lummi-web` is the stock Caddy image (it binds 80/443 as root inside its container).
- Logs: pino JSON on stdout (`LOG_LEVEL`), Docker `json-file` rotation 10 MB x 5 on every service.
- Userbot: see [Userbot](#userbot) below. It runs only where `.env` has `COMPOSE_PROFILES=userbot`.

## Staging layout (Sardor's shared VPS 185.209.228.62)

- Host nginx owns 80/443 and terminates TLS (one certbot cert for the four hosts), proxying all of them to `127.0.0.1:4180` with `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`. Our Caddy runs `CADDY_SCHEME=http://` (plain HTTP, no ACME) and trusts forwarded headers from `TRUSTED_PROXIES` only. The admin cookie is `Secure` because the API runs with `NODE_ENV=production`.
- **The client address** (the sign-in lock per address, ADR 0038). Caddy reads it from the right of `X-Forwarded-For`, skipping only trusted hops (`trusted_proxies_strict`), and passes it to the API as `X-Real-IP` on every host. A proxy in front should send exactly the address it saw, not append to what the client sent:

  ```nginx
  proxy_set_header X-Forwarded-For $remote_addr;
  ```

  (`$proxy_add_x_forwarded_for` also works with the strict mode, which takes its last entry, but `$remote_addr` leaves nothing to get wrong.)
- **IPv6.** If a host has an AAAA record but Docker has no IPv6, every IPv6 client reaches Caddy as the one Docker gateway address and shares one per-address count: twenty wrong passwords from anyone would lock sign-in for all IPv6 clients. Publish no AAAA record for the four hosts, or enable IPv6 in Docker (`"ipv6": true` with a `fixed-cidr-v6` in `daemon.json`, and `enable_ipv6` on the Compose network).
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
| `OIL_PRICES_FILE` | optional: the owner's oil price list (JSON, customer data, never in the repository) as a path inside the api container, e.g. `/data/files/private/oil-prices.json`; the seed fills empty oil prices from it on each deploy (#75). Empty: skipped |
| `BOT_MODE`, `LOG_LEVEL` | optional; defaults `webhook`, `info` |
| `COMPOSE_PROFILES` | `userbot` once the userbot is logged in (below); unset before |
| `USERBOT_API_ID`, `USERBOT_API_HASH` | an app registered at my.telegram.org → API development tools (any account's; they name the app, not the account) |
| `USERBOT_SESSION_KEY` | `openssl rand -base64 32`; seals the session file. Losing it means logging in again; leaking it with the volume means ending the session |
| `USERBOT_LISTEN_CHAT_ID` | the chat the userbot reads: the official Humo bot's id in production (from `whois.ts`), the test bot's id on staging (the number before the colon of its token) |
| `USERBOT_REQUIRE_VERIFIED` | `true` in production: the listened bot must carry Telegram's verified tick, or the userbot parks. Unset (false) on staging, where the test bot has none |

## First deploy on a fresh host

Human steps first, in this order:

1. On the VPS, as root: `install -d -o lummi-deploy -g lummi-deploy -m 700 /opt/lummi-staging`.
2. As `lummi-deploy`, write `/opt/lummi-staging/.env` from `deploy/staging.env.example` and `chmod 600` it.
3. Push to `stage-1` (or run the workflow on `stage-1`/`main`). CI copies `docker-compose.yml`, pulls, migrates, seeds, starts, and writes `.deploy.env`. The API sets the Telegram webhook and the default menu button itself when it boots (`BOT_MODE=webhook`; `drop_pending_updates` is false).
4. Add the owner once, by hand, then give them a password (ADR 0038). The login is what the owner types on the sign-in page (3–32 of `a-z 0-9 . _ -`); the Telegram id (the customer's real one; the 990000001 in the dev seed is a placeholder) is optional and lets the owner use «Войти через Telegram» and the orders-group buttons. Without it the owner binds Telegram later in the panel: Профиль → «Привязать Telegram».

```sh
cd /opt/lummi-staging && dc='docker compose --env-file .env --env-file .deploy.env'
$dc run --rm -T api node --import tsx src/cli/seed-owner.ts --login <login> --name "<name>" [--telegram-id <the customer's id>]
$dc run --rm -T api node --import tsx src/cli/set-owner-password.ts --login <login>
```

`set-owner-password` prints a generated temporary password **once**, in this terminal only (the database keeps only its argon2id hash; it never reaches a log). Hand it to the owner in person or over a channel you trust, not in the project chat. At the first sign-in the panel asks for a new password and opens nothing else until it is set. `seed:owner` is idempotent. To add a login to an owner seeded by Telegram id only, pass **the same `--telegram-id`** with the `--login` (`seed:owner --telegram-id <id> --login <login> --name "<name>"`): the record is found by its Telegram id and gains the login. A `--login`-only run that finds an owner without a login refuses and prints that command, so it never adds a second owner by mistake; `--new-owner` adds another owner on purpose (a developer account during development). `set-owner-password` also lifts a lock on that login.

**The owner lost the password.** Run `set-owner-password --login <login>` again (the line above). It replaces the password with a new temporary one, ends every session the owner had, and is written to the audit log («Выдан временный пароль», actor «Система»). A manager's password is reset by the owner in the panel: Сотрудники → «Сбросить пароль». If the owner also forgot the login, read it from the database: `$dc exec postgres psql -U lummi -d lummi -c "select login, name from staff where role = 'owner'"`.

**Sign-in locks.** Five wrong passwords for one login within 15 minutes, or twenty from one address, close sign-in for that login or address for 15 minutes (Настройки → «Вход и сессии»: every number is a setting). To lift a lock at once, `$dc exec postgres psql -U lummi -d lummi -c "delete from login_throttles"`.

The seed step (`src/cli/seed-staging.ts`) loads the 67-fragrance catalog (placeholder prices, photos, Discovery set) only while the catalog is empty, and adds missing BTS points; a second run changes nothing.

**Oil prices (#75).** The owner's oil price list (a JSON list of `{ name, tier, oilPrice, supplier, invoice }`) is customer data and is never committed. Put it into the files volume's `private/` (never served; backed up like the receipts), point `OIL_PRICES_FILE` at it, and run the seed step once; every later deploy runs it again. It fills only the fields a fragrance has empty and never overwrites what the owner set. A missing or unreadable file, or a bad row, is logged and skipped, never a failed deploy.

```sh
cd /opt/lummi-staging && dc='docker compose --env-file .env --env-file .deploy.env'
chmod 644 oil-prices.json          # the api runs as `node`; the copy lands owned by root
$dc cp oil-prices.json api:/data/files/private/oil-prices.json
echo 'OIL_PRICES_FILE=/data/files/private/oil-prices.json' >> .env
$dc run --rm -T api node --import tsx src/cli/seed-staging.ts   # fills now; prints «oil prices: …»
rm oil-prices.json                 # the volume holds it now
```

A new list later: copy it over the same path and run the seed step again (or wait for the next deploy). It fills only what is still empty; to change a price the owner set, edit it in the panel or the Excel file.

**Order costs (#77).** The same seed step gives every paid order without a cost snapshot (orders paid before #77) its snapshot, with the oil prices and settings of that moment, and prints «order costs: N orders frozen». An order whose fragrance has no oil price yet is left for a later run. A frozen snapshot is never touched, so the step is safe on every deploy.

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

## Userbot

The userbot (ADR 0014, 0035) is logged into a **personal** Telegram account: the customer's in production, Sardor's on staging. Its session is full access to that account. It is sealed with `USERBOT_SESSION_KEY` in the `userbot-data` volume and never leaves the server. It reads one chat (`USERBOT_LISTEN_CHAT_ID`), posts each message to the API's internal endpoint, forwards each ➕ to the orders group's «Поступления» topic, and sends a heartbeat each minute once caught up.

Before the login:

- The account has a two-step verification password (the login refuses an account without one), and it is a member of the orders supergroup (forwards are sent as that account).
- In the admin, Settings: `bot.groupChatId` and the «Поступления» topic id (`bot.topics`) are filled. Without the group nothing is forwarded; credits are still recorded.
- `.env` has `USERBOT_API_ID`, `USERBOT_API_HASH`, `USERBOT_SESSION_KEY` and `USERBOT_LISTEN_CHAT_ID` (staging: the test bot's id, below). Do not set `COMPOSE_PROFILES` yet.

Log in, with the account owner at hand for the code and the 2FA password. The login is interactive, so run it from a terminal (`compose run` gives it one; do not add `-T`). `run` starts the service even with its profile off; `--rm` removes the one-off container, the volume stays:

```sh
$dc run --rm userbot node --import tsx src/cli/login.ts            # phone, code, 2FA password; prints the account's user id
$dc run --rm userbot node --import tsx src/cli/whois.ts @<humo bot>  # production: the id for USERBOT_LISTEN_CHAT_ID
```

Production: use the id only if `whois` says `bot: true, verified: true`, and set `USERBOT_REQUIRE_VERIFIED=true`, so a look-alike bot can never be the listened chat.

Then add `COMPOSE_PROFILES=userbot` to `.env` and `$dc up -d userbot`. Deploys keep it running from then on (`pull` and `up` follow the profile). Check `$dc logs userbot`: it says `caught up with the Humo chat`. With nothing stored yet it starts after the newest message and does not import the history, so send a test ➕ right away (production: a small real transfer to the shop card; staging: the sample script below). It must appear in «Поступления» and under admin credits.

- **Staging's Humo stand-in.** Create a bot of its own with @BotFather (never the shop bot), and press Start in it from the userbot's account. Set `USERBOT_LISTEN_CHAT_ID` to the number before the colon of its token (the script below prints it too) and leave `USERBOT_REQUIRE_VERIFIED` unset. From a checkout with `HUMO_TEST_BOT_TOKEN` (that bot's token) and `HUMO_TEST_CHAT_ID` (the userbot account's user id, which the login printed: «Logged in as user N») in `.env.local`: `npm run humo:sample -w @lummi/userbot -- credit 99000 --card <shop card last 4>`, or `debit 75750`, or `other`. A credit for an order's total on the shop card confirms that order.
- **Stopped userbot.** If the session is ended (Settings > Devices, «LUMMI userbot»), the account logs out everywhere, the session file or key is wrong, or the listened chat is not a bot (or not verified while `USERBOT_REQUIRE_VERIFIED=true`), it logs one error (`userbot stopped: it needs a person`, with the reason) and stays up idle: no heartbeats, so receipt timers pause and the owner is alerted (#36). Fix the cause; for a session, run the login again with `--force` (it replaces the file) and end the older «LUMMI userbot» under Devices. Then `$dc restart userbot`.
- **Another account.** Clear the stored Humo messages first (spec Changes 2026-11-09, «For the userbot»), or the new account's lower message ids are skipped as already seen.
- **Turn it off.** Remove `COMPOSE_PROFILES=userbot` and `$dc stop userbot`. To revoke it for good, end «LUMMI userbot» under Devices and delete the volume (`docker volume rm <project>_userbot-data`).

## BotFather (cannot be done by API)

- `/setdomain` for the staging bot = `admin.<DOMAIN>` (the admin Login Widget).
- Bot Settings > Configure Mini App > set `https://<DOMAIN>/` as the bot's main Mini App (needed for `?startapp=` links).

## Production (customer's dedicated VPS)

Same Compose file: `CADDY_SCHEME` empty (Caddy then also sends HSTS), no `CADDY_*_PUBLISH` or `TRUSTED_PROXIES` lines, DNS for the four hosts pointing at the server (A records; an AAAA record only with Docker IPv6, see the IPv6 note under Staging), ports 80/443 free. Caddy gets certificates itself. Deploys come from `v*` tags only (not wired yet; it needs the customer's SSH secrets).

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

Decision: a **host systemd timer**, not a Compose service (ADR 0036). The restore test needs a throwaway Postgres container, and `rsync` has to read the `files` volume and ssh to the second location. From a container that would mean handing it the Docker socket, which is root on the host. A timer needs only `age`, `rsync` and Docker, and `OnCalendar=... Asia/Tashkent` fixes the time whatever the host's timezone.

What runs every day at 03:00 Asia/Tashkent (`deploy/backup/backup.sh`):

1. `pg_dump -Fc` (compressed) piped straight into `age`, so no plaintext dump touches the disk: `/var/backups/lummi/daily/lummi-<date>.dump.age`. The file must carry the `age` header and be larger than an empty dump, or the run fails. Sunday's dump is copied to `weekly/`. Rotation is **by the date in the file name**: 14 days of daily, 8 weeks of weekly (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`).
2. The `.env` and the userbot session, each `age`-encrypted into `secrets/` under a dated name. The session file is in the `userbot-data` volume (ticket #19): `BACKUP_USERBOT_SESSION=/var/lib/docker/volumes/<project>_userbot-data/_data/<session file>`. The session is full access to the customer's own Telegram account; ADR 0025 lets it leave the server **only** inside this encrypted backup, to the second location in Uzbekistan.
3. **Receipts** (`files/private`, payer names and card masks): one `age` file per receipt in a local tree `private-enc/`. Only new or changed receipts are encrypted again, so `rsync` stays incremental. A receipt deleted at the source is deleted from `private-enc/` and from the second copy (a purge reaches the copy), never more than `BACKUP_MAX_PURGE` (50) at once: a run that would delete more stops, because an unmounted volume looks like a purge of everything.
4. The second copy over ssh (key-only, `ConnectTimeout`, `ServerAliveInterval`, rsync `--timeout`) to `BACKUP_RSYNC_TARGET`, which must be inside Uzbekistan (ADR 0025): `dumps/`, `secrets/` and the public photos are **add only** (no `--delete`, `--ignore-existing`); `private/` is the encrypted receipt mirror and is the only tree the VPS may delete in. Until the customer names a target, leave it empty: the run is reported as having skipped `second-copy`, and the owner and developer are told once a day.
5. A good run writes `/var/backups/lummi/last-success` and reports to the API (`POST /internal/backup/report`, through `docker exec` into the api container; the secret never appears on a command line).

### Alerts: every failure and every skip is heard

- `lummi-backup.service` has `OnFailure=lummi-backup-failure.service`, which sends a fixed text through the bot to `BACKUP_ALERT_CHAT_ID` for any failure: a command error, the 2-hour `TimeoutStartSec`, a kill.
- Failures nothing on the host can report (the timer disabled, the host down at 03:00, the script stuck before it could fail) are caught by the API: no report for longer than the setting `ops.backupStaleSeconds` (default 26 h) alerts the owner and the developer once per gap.
- A skipped step (second copy, userbot session, receipts) alerts once a day through the same report.

### Disk

The VPS holds 14 daily + 8 weekly dumps, the encrypted receipt mirror (about the size of `files/private`) and 60 days of small secrets. Budget `22 x dump size + 1.2 x files/private + 1 GB`, and check `df -h /var/backups` monthly. The second location needs the same, plus the public photos.

### The second location must not trust the VPS

A rebuilt or compromised VPS must not be able to wipe the off-host dumps. The VPS therefore only **adds** files there, and the target rotates by itself. Two options, use both if you can:

1. **Rotation on the target** (`deploy/backup/offsite-rotate.sh`, copy it there; daily cron, as a user the VPS cannot log in as): `0 4 * * * /opt/lummi-backup/offsite-rotate.sh /srv/lummi`. It deletes by the date in the name: 14 days of daily dumps, 8 weeks of weekly dumps, 60 days of secrets, and nothing else.
2. **A restricted key**: in `~backup/.ssh/authorized_keys` of the target, one key for dumps, secrets and photos that cannot delete, and one that can only touch the receipt mirror:

```
command="rrsync -no-del /srv/lummi",restrict ssh-ed25519 AAAA... lummi-vps-add-only
command="rrsync /srv/lummi/private",restrict ssh-ed25519 AAAA... lummi-vps-receipts
```

With `rrsync` the remote paths are relative to its root: set `BACKUP_RSYNC_TARGET=backup@host:` and `BACKUP_RSYNC_TARGET_PRIVATE=backup@host:`, with `BACKUP_SSH_KEY` and `BACKUP_SSH_KEY_PRIVATE` for the two keys. Without `rrsync`, set `BACKUP_RSYNC_TARGET=backup@host:/srv/lummi` and rely on option 1.

### Install (once, as root, on the host)

```sh
apt-get install -y age rsync jq curl
install -d -m 700 /opt/lummi/backup && cp deploy/backup/{backup.sh,restore.sh,restore-private.sh,failure-alert.sh,lib.sh} /opt/lummi/backup/
cp deploy/backup/lummi-backup.{service,timer} deploy/backup/lummi-backup-failure.service /etc/systemd/system/
# put the BACKUP_* keys (deploy/staging.env.example) into the stack's .env; the service reads /opt/lummi/.env
systemctl daemon-reload && systemctl enable --now lummi-backup.timer
systemctl start lummi-backup.service && journalctl -u lummi-backup -n 20     # first run by hand
/opt/lummi/backup/backup.sh --dry-run                                         # only lists what the second copy would receive
```

Second-copy ssh: `ssh-keygen -t ed25519 -f /root/.ssh/lummi_backup -N ''` (and a second one for the receipt mirror), the public halves into the target's `authorized_keys` as above, the host key pinned once with `ssh-keyscan -H <host> >> /root/.ssh/known_hosts` (the script uses `StrictHostKeyChecking=yes`).

### The decryption key

The owner generates the key pair on **their own computer**, not on the server: `age-keygen -o lummi-backup-key.txt`. The line `Public key: age1...` goes into `BACKUP_AGE_RECIPIENT`. The file is the private key: the owner keeps two copies offline (a password manager and a printed or USB copy in a safe place). **It never goes onto the VPS or the second location** (a root user on the VPS could then read every backup). **Without it every backup is unreadable and nobody can recover it.** Check it the day it is made: encrypt a line with the public key and decrypt it with the file.

### Monthly restore test (where the key is, not on the VPS)

Run it on the owner's computer, or on a throwaway machine the key is brought to, anything with Docker, `age` and the repo's `deploy/backup/`. It also proves the second copy is readable.

```sh
# 1. fetch the newest dump FROM THE SECOND LOCATION (not from the VPS)
rsync -a backup@<second-host>:/srv/lummi/dumps/daily/ ./dumps/
# 2. restore it into a throwaway postgres:17-alpine, check, delete the container
deploy/backup/restore.sh --identity lummi-backup-key.txt --dump ./dumps/lummi-<newest>.dump.age
```

It prints the row counts of the key tables and the number of recorded migrations, then removes the container; it never touches a running stack. First Monday of each month: the counts must look like the shop (orders and customers close to the admin's numbers). Once a quarter also fetch a weekly dump and one `private/` receipt and decrypt it (`age -d -i key file.age`). Write the date and result in the handover log. `--keep` leaves the container for a look (`docker rm -fv <name>` afterwards).

### Disaster recovery, in full

For a lost or compromised VPS, on a new host, with the owner present (the key is needed):

1. **Host.** Ubuntu 24.04, the hardening and Docker steps of "Production" above, DNS for the four hosts to the new IP. Bring the key in, not onto disk: `install -m 600 /dev/null /dev/shm/key && cat > /dev/shm/key` (paste, Ctrl-D); `/dev/shm` is memory. Delete it at the end: `rm /dev/shm/key` (it is gone at reboot anyway).
2. **Fetch from the second location**: `rsync -a backup@<second-host>:/srv/lummi/ /root/restore/` (dumps, secrets, private, media).
3. **The `.env`**: `age -d -i /dev/shm/key /root/restore/secrets/env-<newest date>.age > /opt/lummi/.env && chmod 600 /opt/lummi/.env`. Check `DOMAIN`, the bot token and the secrets; the `BACKUP_*` keys come with it.
4. **Images and empty services**: `docker login` for ghcr.io (read-only token), copy `docker-compose.yml`, write `.deploy.env` (`IMAGE_TAG`, `GHCR_OWNER`), `$dc pull && $dc up -d --wait postgres redis`. Do **not** start the api, worker or userbot yet.
5. **The database**: `age -d -i /dev/shm/key /root/restore/dumps/daily/lummi-<newest>.dump.age | docker exec -i $($dc ps -q postgres) pg_restore -U lummi -d lummi --no-owner --exit-on-error`. The container starts with an empty `lummi` database from `POSTGRES_DB`; if `pg_restore` complains it is not empty, `docker exec ... dropdb`/`createdb` first. The dump already holds the `drizzle` migration table, so the next deploy migrates only what is new.
6. **Media**: create the `files` volume (`docker volume create <project>_files`), copy `/root/restore/media/public/` into `<volume>/_data/public/`, then decrypt the receipts: `deploy/backup/restore-private.sh --identity /dev/shm/key /root/restore/private <volume>/_data/private`. Make the files readable by the api user as on the old host.
7. **The userbot session** (ticket #19): `age -d -i /dev/shm/key /root/restore/secrets/userbot-session-<date>.age > <userbot-data volume>/_data/<session file>`, same owner and mode as before. If the customer revoked the session or doubts the old host, skip this and log the userbot in again instead.
8. **Start**: `$dc up -d --wait`. The API sets the webhook itself at boot.
9. **Verify**: `curl https://api.<DOMAIN>/health` is `{"status":"ok"}`; sign in to the admin; the orders and customers counts match the last known numbers; open a receipt image; send a message to the bot; check the worker heartbeat alert did not fire (or fired and recovered); place a test order in staging style if the shop is closed.
10. Reinstall the backup timer (Install above), run it once by hand, `rm /dev/shm/key`, and tell the owner the recovery time and the newest dump's date: everything after it is lost (up to 24 h).

## Monitoring

- **Error pings.** Every unexpected API 500 and every failed worker sweep is filed in the `error_events` table by a fingerprint (error class, route pattern, top stack frames; no message, no query string, no ids). The first time a fingerprint appears the developer gets one Telegram message; repeats only raise `count` and `last_seen_at`. Set the developer's Telegram id (a number, from the developer's own chat with the bot) in the admin settings (`ops.developerChatId`); until set, the first occurrence only reaches the log. Read the table with `docker compose exec postgres psql -U lummi -c 'select route, error_class, count, last_seen_at from error_events order by last_seen_at desc'`.
- **Worker watch.** The worker stamps `worker_heartbeat` every minute. The API checks it every minute; after `ops.workerSilentSeconds` (default 180) of silence the owner (DMs, «Системные» topic) and the developer get one alert, and one more when it returns. The alert is sent straight to Telegram, since the outbox is delivered by the worker that is down. It says «снова работает» only when a beat newer than the alert arrives, so an API restart during an outage never reports a false recovery.
- **Uptime monitor (external, every minute).** Use a free pinger such as UptimeRobot (Free: 5-minute interval; the 1-minute interval needs a paid plan) or Better Stack, or a second small VPS in Uzbekistan running a cron `curl`. Two HTTP monitors, 1-minute interval, alert on 2 consecutive failures, notify by Telegram (the monitor's own bot) and e-mail: `https://api.<DOMAIN>/health` (expects 200 `{"status":"ok"}`; 503 means the database is down) and `https://<DOMAIN>/` (the Mini App, expects 200). Create the monitor account in the customer's or the developer's name and write it down in the handover log. It covers the case the API watch cannot: the whole host being down.

## Local check of the production stack

`docker compose --env-file <env> config` validates it. To try it on a laptop, build the three images (`docker build --target api|admin|web .`, one at a time), tag them `ghcr.io/<owner>/lummi-<name>:<IMAGE_TAG>`, set `DOMAIN=lummi.localhost`, and `curl --resolve` or send `Host:` headers to the Caddy port.

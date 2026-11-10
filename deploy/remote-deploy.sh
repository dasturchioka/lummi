#!/usr/bin/env bash
# Runs ON the VPS (ADR 0024). The deploy job copies it to the deploy dir next to docker-compose.yml, then
# sends the GHCR token as the only stdin line, read by the remote command first, so it never appears
# in `ps` (the host is shared):
#   printf '%s\n' "$GHCR_TOKEN" |
#     ssh host "read -r GHCR_TOKEN; export GHCR_TOKEN; bash /opt/lummi-staging/remote-deploy.sh <image-tag> <ghcr-owner> <ghcr-actor> </dev/null"
# Never pipe this script into `bash -s`: `docker compose run` reads stdin and swallows the rest of it.
set -euo pipefail

TAG="${1:?image tag}"
OWNER="${2:?ghcr owner}"
ACTOR="${3:?ghcr actor}"
DIR="${DEPLOY_DIR:-/opt/lummi-staging}"
cd "$DIR"
test -f .env || { echo "$DIR/.env is missing (see docs/run-guide.md)"; exit 1; }

# The new tag applies to this run only (shell variables beat env files); `.deploy.env`, which later
# manual commands read, is rewritten only after the new stack is up. A failed deploy leaves it alone.
export IMAGE_TAG="$TAG" GHCR_OWNER="$OWNER"
dc() { docker compose --env-file .env "$@"; }

# The job's own token, valid for this run only; nothing long-lived stays on the host.
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$ACTOR" --password-stdin >/dev/null
unset GHCR_TOKEN
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

dc pull
dc up -d --wait postgres redis
dc run --rm -T api node --import tsx ../../packages/db/src/migrate-cli.ts </dev/null
dc run --rm -T api node --import tsx src/cli/seed-staging.ts </dev/null
# The API sets the webhook and the menu button itself when it boots (BotService.start).
dc up -d --wait --remove-orphans

[ -f .deploy.env ] && cp .deploy.env .deploy.env.prev
printf 'IMAGE_TAG=%s\nGHCR_OWNER=%s\n' "$TAG" "$OWNER" > .deploy.env
dc ps

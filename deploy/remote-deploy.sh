#!/usr/bin/env bash
# Runs ON the VPS, fed over SSH by the deploy job (ADR 0024):
#   env GHCR_TOKEN=... GHCR_ACTOR=... bash -s -- <image-tag> <ghcr-owner> < deploy/remote-deploy.sh
# The GHCR credentials come in as environment (never written to disk); see .github/workflows/deploy.yml.
set -euo pipefail

TAG="${1:?image tag}"
OWNER="${2:?ghcr owner}"
DIR="${DEPLOY_DIR:-/opt/lummi-staging}"
cd "$DIR"
test -f .env || { echo "$DIR/.env is missing (see docs/run-guide.md)"; exit 1; }

# Non-secret, written by us on every deploy; compose reads it after .env.
printf 'IMAGE_TAG=%s\nGHCR_OWNER=%s\n' "$TAG" "$OWNER" > .deploy.env
dc() { docker compose --env-file .env --env-file .deploy.env "$@"; }

# The job's own token, valid for this run only; nothing long-lived stays on the host.
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_ACTOR" --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

dc pull
dc up -d --wait postgres redis
dc run --rm -T api node --import tsx ../../packages/db/src/migrate-cli.ts
dc run --rm -T api node --import tsx src/cli/seed-staging.ts
dc up -d --wait --remove-orphans
dc run --rm -T api node --import tsx src/cli/bot-setup.ts
dc ps

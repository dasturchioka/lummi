#!/usr/bin/env bash
# Restore test (ADR 0025): decrypt a chosen dump into a THROWAWAY Postgres container, run a sanity query,
# delete the container. It never touches the running stack. Run it monthly (docs/run-guide.md).
#
#   restore.sh --identity /path/to/age-key.txt [--dump FILE | --latest] [--keep]
#
#   --identity   the owner's private age key (kept offline; copy it to the host only for the test, then delete it)
#   --dump FILE  an encrypted dump (lummi-*.dump.age); default --latest of BACKUP_DIR/daily
#   --keep       leave the container running for a look (it is named in the output; remove it yourself)
# Settings: BACKUP_DIR (/var/backups/lummi), RESTORE_PG_IMAGE (postgres:17-alpine, the production major version).
set -Eeuo pipefail
umask 077
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$here/lib.sh"
export BACKUP_ENV_FILE=${BACKUP_ENV_FILE:-/opt/lummi/.env}

identity='' dump='' keep=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --identity) identity=${2:?--identity needs a file}; shift 2 ;;
    --dump) dump=${2:?--dump needs a file}; shift 2 ;;
    --latest) dump=''; shift ;;
    --keep) keep=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
[[ -r $identity ]] || die 'give the private key: --identity FILE'
need age 'apt install age'
need docker 'the throwaway database runs in Docker'
dir=$(cfg BACKUP_DIR /var/backups/lummi)
if [[ -z $dump ]]; then
  dump=$(find "$dir/daily" -maxdepth 1 -type f -name 'lummi-*.dump.age' | sort | tail -n 1)
fi
[[ -r $dump ]] || die "no dump to restore (looked in $dir/daily)"
image=$(cfg RESTORE_PG_IMAGE postgres:17-alpine)
name=lummi-restore-test-$$
# A password no one needs: the container has no published port and lives for a minute.
password=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')

cleanup() {
  if [[ $keep == 1 ]]; then log "container kept: $name (docker rm -fv $name)"; else docker rm -fv "$name" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

log "restoring $(basename "$dump") into a throwaway $image"
docker run -d --name "$name" -e POSTGRES_USER=lummi -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=lummi "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -U lummi -d lummi -q 2>/dev/null && break
  sleep 1
done
# pg_isready answers during the image's init phase too; wait for the real server (the init server only listens on the socket).
for _ in $(seq 1 30); do
  docker exec "$name" psql -U lummi -h 127.0.0.1 -d lummi -Atc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
age -d -i "$identity" "$dump" | docker exec -i "$name" pg_restore -U lummi -d lummi --no-owner --exit-on-error

log 'sanity check: row counts of the key tables'
tables=(customers fragrances orders order_lines receipts credits staff audit_log)
total=0
for table in "${tables[@]}"; do
  count=$(docker exec "$name" psql -U lummi -d lummi -Atc "select count(*) from $table")
  printf '%-14s %s\n' "$table" "$count"
  total=$((total + count))
done
# Counts of 0 are normal on staging; the check that matters is that pg_restore finished and the migrations table is there.
migrations=$(docker exec "$name" psql -U lummi -d lummi -Atc 'select count(*) from drizzle.__drizzle_migrations')
printf '%-14s %s\n' migrations "$migrations"
[[ $migrations -gt 0 ]] || die 'no migrations recorded: this is not a LUMMI database'
log "restore OK ($total rows in the key tables). Removing the container."

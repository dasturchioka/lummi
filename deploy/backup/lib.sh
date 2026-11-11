# Shared by backup.sh and restore.sh. Sourced, never run. No arbitrary `source .env`: only named keys are read.

# cfg KEY [DEFAULT]: the process environment wins, then KEY= in $BACKUP_ENV_FILE, then DEFAULT.
cfg() {
  local key=$1 default=${2-} value
  value=${!key-}
  if [[ -z $value && -r ${BACKUP_ENV_FILE:-} ]]; then
    value=$(grep -E "^${key}=" "$BACKUP_ENV_FILE" | tail -n 1 | cut -d= -f2- || true)
    value=${value%\"}; value=${value#\"}; value=${value%\'}; value=${value#\'}
  fi
  printf '%s' "${value:-$default}"
}

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed ($2)"; }

# The postgres container: BACKUP_PG_CONTAINER, else the Compose service of this project.
pg_container() {
  local c
  c=$(cfg BACKUP_PG_CONTAINER)
  if [[ -z $c ]]; then
    c=$(docker ps -q \
      --filter "label=com.docker.compose.project=$(cfg COMPOSE_PROJECT_NAME lummi)" \
      --filter 'label=com.docker.compose.service=postgres' | head -n 1)
  fi
  [[ -n $c ]] || die 'postgres container not found (is the stack up? or set BACKUP_PG_CONTAINER)'
  printf '%s' "$c"
}

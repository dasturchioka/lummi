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

# The compose container of a service of this project (api, postgres).
service_container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$(cfg COMPOSE_PROJECT_NAME lummi)" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

# A fixed-text alert to Telegram through the bot. The token stays out of argv (curl config on stdin).
telegram_alert() {
  local token chat
  token=$(cfg BOT_TOKEN); chat=$(cfg BACKUP_ALERT_CHAT_ID)
  [[ -n $token && -n $chat ]] || { log "no BOT_TOKEN / BACKUP_ALERT_CHAT_ID: alert not sent: $1"; return 0; }
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
    curl -sS --max-time 20 -K - --data-urlencode "chat_id=$chat" --data-urlencode "text=$1" >/dev/null ||
    log 'alert could not be sent'
}

# Tell the API a run finished (ADR 0035). `docker exec` into the api container: the call comes from
# 127.0.0.1 there and the secret is read from the container's own environment, never from argv.
# Arguments: the names of skipped steps. A failure here is only a warning; the API's stale-backup check covers it.
report_to_api() {
  local api skipped='' s
  api=$(service_container api)
  [[ -n $api ]] || { log 'WARN: api container not found, run not reported'; return 0; }
  # step names are our own fixed words, so plain quoting is enough
  for s in "$@"; do skipped+="${skipped:+,}\"$s\""; done
  printf '{"skipped":[%s]}' "$skipped" | docker exec -i "$api" node -e "
    let b='';process.stdin.on('data',d=>b+=d).on('end',()=>fetch('http://127.0.0.1:4000/internal/backup/report',
    {method:'POST',headers:{'content-type':'application/json','x-internal-secret':process.env.INTERNAL_API_SECRET||''},body:b})
    .then(r=>process.exit(r.ok?0:1),()=>process.exit(1)))" || log 'WARN: the API did not take the report'
}

#!/usr/bin/env bash
# Daily backup (ADR 0024, 0025): encrypted pg_dump + rotation, then the second copy. Runs on the host
# as root from the systemd timer in this folder (03:00 Asia/Tashkent). See docs/run-guide.md.
#
#   backup.sh                 dump, rotate, secrets, second copy
#   backup.sh --dry-run       same, but rsync only lists what it would send (use it when setting up the target)
#   backup.sh --offsite-only  skip the dump; refresh secrets and run the second copy
#
# Settings (process env, else the keys in $BACKUP_ENV_FILE, default /opt/lummi/.env):
#   BACKUP_AGE_RECIPIENT   required: the owner's public key (age1...). Only the public half lives on the server.
#   BACKUP_DIR             /var/backups/lummi
#   BACKUP_KEEP_DAILY      14        BACKUP_KEEP_WEEKLY   8
#   BACKUP_PG_CONTAINER    optional, else found by the Compose labels of COMPOSE_PROJECT_NAME
#   BACKUP_FILES_DIR       the files volume on the host (/media: public photos and private receipts)
#   BACKUP_USERBOT_SESSION file with the userbot's mtcute session, encrypted before it is copied
#   BACKUP_RSYNC_TARGET    user@host:/path inside Uzbekistan (ADR 0025); empty = second copy skipped, with a warning
#   BACKUP_SSH_KEY         private key for that target (key-only, no password prompts)
#   BACKUP_ALERT_CHAT_ID   Telegram chat that hears about a failed run (uses BOT_TOKEN from the env file)
set -Eeuo pipefail
umask 077
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$here/lib.sh"

export BACKUP_ENV_FILE=${BACKUP_ENV_FILE:-/opt/lummi/.env}
dry_run=0 offsite_only=0
for arg in "$@"; do
  case $arg in
    --dry-run) dry_run=1 ;;
    --offsite-only) offsite_only=1 ;;
    *) die "unknown option $arg" ;;
  esac
done

step=start
on_error() {
  local code=$?
  log "FAILED at step: $step (exit $code)"
  local token chat
  token=$(cfg BOT_TOKEN); chat=$(cfg BACKUP_ALERT_CHAT_ID)
  if [[ -n $token && -n $chat && $dry_run == 0 ]] && command -v curl >/dev/null; then
    # A fixed text: no paths, no data. The token stays out of argv through a curl config on stdin.
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
      curl -sS --max-time 20 -K - --data-urlencode "chat_id=$chat" \
        --data-urlencode "text=Бэкап LUMMI не удался на шаге «$step» ($(hostname)). Смотрите journalctl -u lummi-backup." \
        >/dev/null || true
  fi
  exit "$code"
}
trap on_error ERR

need age 'apt install age'
recipient=$(cfg BACKUP_AGE_RECIPIENT)
[[ $recipient == age1* ]] || die 'BACKUP_AGE_RECIPIENT must be an age public key (age1...)'
dir=$(cfg BACKUP_DIR /var/backups/lummi)
keep_daily=$(cfg BACKUP_KEEP_DAILY 14)
keep_weekly=$(cfg BACKUP_KEEP_WEEKLY 8)
install -d -m 700 "$dir" "$dir/daily" "$dir/weekly" "$dir/secrets"
tz=Asia/Tashkent

# Keep the newest $2 files of a folder; names carry the date, so name order is age order.
rotate() {
  local folder=$1 keep=$2
  find "$folder" -maxdepth 1 -type f -name 'lummi-*.dump.age' -printf '%f\n' | sort -r |
    tail -n "+$((keep + 1))" | while read -r old; do rm -f -- "$folder/$old"; log "rotated out $folder/$old"; done
}

if [[ $offsite_only == 0 ]]; then
  step=dump
  need docker 'the stack runs in Docker'
  container=$(pg_container)
  stamp=$(TZ=$tz date +%F_%H%M)
  file="$dir/daily/lummi-$stamp.dump.age"
  # -Fc is pg_dump's compressed custom format (restore with pg_restore); age encrypts the stream, so no plaintext dump touches the disk.
  docker exec -i "$container" pg_dump -U lummi -d lummi -Fc -Z 6 | age -r "$recipient" -o "$file.partial"
  [[ -s $file.partial ]] || die 'the dump came out empty'
  mv "$file.partial" "$file"
  log "dump written: $file ($(stat -c %s "$file") bytes)"

  step=weekly
  # Sunday's dump is kept as the weekly copy.
  if [[ $(TZ=$tz date +%u) == 7 ]]; then cp -p "$file" "$dir/weekly/"; fi

  step=rotate
  rotate "$dir/daily" "$keep_daily"
  rotate "$dir/weekly" "$keep_weekly"
fi

step=secrets
# The .env and the userbot session are full access to the shop and to the customer's own Telegram account:
# they only ever leave this folder encrypted.
env_file=$BACKUP_ENV_FILE
if [[ -r $env_file ]]; then age -r "$recipient" -o "$dir/secrets/env.age" "$env_file"; else log "WARN: $env_file not readable, .env not backed up"; fi
session=$(cfg BACKUP_USERBOT_SESSION)
if [[ -n $session && -r $session ]]; then
  age -r "$recipient" -o "$dir/secrets/userbot-session.age" "$session"
else
  log 'WARN: no userbot session file (BACKUP_USERBOT_SESSION unset or missing); nothing to back up for it'
fi

step=second-copy
target=$(cfg BACKUP_RSYNC_TARGET)
if [[ -z $target ]]; then
  log 'WARN: BACKUP_RSYNC_TARGET is not set: the second copy is skipped (the target is pending, ADR 0025)'
else
  need rsync 'apt install rsync'
  ssh_cmd='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
  key=$(cfg BACKUP_SSH_KEY); [[ -n $key ]] && ssh_cmd+=" -i $key"
  rsync_opts=(-a --mkpath -e "$ssh_cmd")
  [[ $dry_run == 1 ]] && rsync_opts+=(--dry-run --itemize-changes) && log 'dry run: nothing is sent'
  target=${target%/}
  # The dumps and secrets mirror this folder (rotation carries over); /media is never deleted from the copy.
  rsync "${rsync_opts[@]}" --delete "$dir/daily/" "$target/dumps/daily/"
  rsync "${rsync_opts[@]}" --delete "$dir/weekly/" "$target/dumps/weekly/"
  rsync "${rsync_opts[@]}" --delete "$dir/secrets/" "$target/secrets/"
  files=$(cfg BACKUP_FILES_DIR "/var/lib/docker/volumes/$(cfg COMPOSE_PROJECT_NAME lummi)_files/_data")
  if [[ -d $files ]]; then rsync "${rsync_opts[@]}" "$files/" "$target/media/"; else log "WARN: files dir $files not found, /media not copied"; fi
fi

step=done
[[ $dry_run == 1 ]] || date -u +%FT%TZ > "$dir/last-success"
log "backup finished (dry-run=$dry_run)"

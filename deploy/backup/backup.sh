#!/usr/bin/env bash
# Daily backup (ADR 0024, 0025, 0036): encrypted pg_dump + rotation by date, the encrypted secrets, an
# encrypted mirror of the private receipts, then the second copy. Runs on the host as root from the
# systemd timer in this folder (03:00 Asia/Tashkent). See docs/run-guide.md.
#
#   backup.sh                 everything
#   backup.sh --dry-run       only the second copy, and rsync only LISTS what it would send: no dump,
#                             no rotation, no new files (use it when setting up the target)
#   backup.sh --offsite-only  skip the dump and the rotation; refresh the secrets, the private mirror, the second copy
#
# Failure alerts are not sent from here: systemd's OnFailure= starts failure-alert.sh for any failure.
# A finished run is reported to the API (its stale-backup check alerts when reports stop), with the
# steps it skipped; a skipped step alerts once a day through the API.
#
# Settings (process env, else the keys in $BACKUP_ENV_FILE, default /opt/lummi/.env):
#   BACKUP_AGE_RECIPIENT   required: the owner's public key (age1...). Only the public half lives on the server.
#   BACKUP_DIR             /var/backups/lummi
#   BACKUP_KEEP_DAILY      14 (days)       BACKUP_KEEP_WEEKLY   8 (weeks)       rotation is by the date in the file name
#   BACKUP_PG_CONTAINER    optional, else found by the Compose labels of COMPOSE_PROJECT_NAME
#   BACKUP_FILES_DIR       the files volume on the host (public photos, private receipts)
#   BACKUP_USERBOT_SESSION file with the userbot's session (in the userbot-data volume), age-encrypted before it is copied
#   BACKUP_RSYNC_TARGET    user@host:/path inside Uzbekistan (ADR 0025); dumps, secrets, public photos. Add-only (see run guide)
#   BACKUP_SSH_KEY         key for that target
#   BACKUP_RSYNC_TARGET_PRIVATE  where the encrypted receipts go (default: $BACKUP_RSYNC_TARGET/private); purges reach it
#   BACKUP_SSH_KEY_PRIVATE key for that one (default: BACKUP_SSH_KEY)
#   BACKUP_MAX_PURGE       50: a run that would delete more encrypted receipts than this (locally or on the target) stops
#   BACKUP_ALERT_CHAT_ID   Telegram chat for failure-alert.sh (uses BOT_TOKEN from the env file)
set -Euo pipefail
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

# Any failing command ends the run (no `set -e`, so no second ERR report from inside functions).
trap 'log "FAILED (line $LINENO)"; exit 1' ERR
partial=''
trap '[[ -z $partial ]] || rm -f -- "${partial:?}"' EXIT

need age 'apt install age'
recipient=$(cfg BACKUP_AGE_RECIPIENT)
[[ $recipient == age1* ]] || die 'BACKUP_AGE_RECIPIENT must be an age public key (age1...)'
dir=$(cfg BACKUP_DIR /var/backups/lummi)
keep_daily=$(cfg BACKUP_KEEP_DAILY 14)
keep_weekly=$(cfg BACKUP_KEEP_WEEKLY 8)
max_purge=$(cfg BACKUP_MAX_PURGE 50)
tz=Asia/Tashkent
skipped=()
files=$(cfg BACKUP_FILES_DIR "/var/lib/docker/volumes/$(cfg COMPOSE_PROJECT_NAME lummi)_files/_data")
[[ $dry_run == 1 ]] || install -d -m 700 "$dir" "$dir/daily" "$dir/weekly" "$dir/secrets" "$dir/private-enc"

# Delete files of a folder whose name carries a date older than N days. By date, not by count: a
# burst of manual runs cannot push the real history out.
rotate() {
  local folder=${1:?} days=${2:?} cutoff name day
  cutoff=$(TZ=$tz date -d "-$days days" +%F)
  while IFS= read -r name; do
    day=$(grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' <<<"$name" | head -n 1)
    if [[ -n $day && $day < $cutoff ]]; then rm -f -- "${folder:?}/${name:?}"; log "rotated out $folder/$name"; fi
  done < <(find "$folder" -maxdepth 1 -type f -printf '%f\n')
}

# A real age file: the header, and more bytes than an empty database dumps to.
valid_age() { [[ $(head -c 22 "$1") == 'age-encryption.org/v1' && $(stat -c %s "$1") -gt 4096 ]]; }

if [[ $dry_run == 0 && $offsite_only == 0 ]]; then
  need docker 'the stack runs in Docker'
  container=$(pg_container)
  stamp=$(TZ=$tz date +%F_%H%M)
  file="$dir/daily/lummi-$stamp.dump.age"
  partial="$file.partial"
  # -Fc is pg_dump's compressed custom format (restore with pg_restore); age encrypts the stream, so no plaintext dump touches the disk.
  docker exec -i "$container" pg_dump -U lummi -d lummi -Fc -Z 6 | age -r "$recipient" -o "$partial"
  valid_age "$partial" || die 'the dump is not a plausible age file (header or size)'
  mv "$partial" "$file"
  partial=''
  log "dump written: $file ($(stat -c %s "$file") bytes)"
  # Sunday's dump is also kept as the weekly copy.
  if [[ $(TZ=$tz date +%u) == 7 ]]; then cp -p "$file" "$dir/weekly/"; fi
  rotate "$dir/daily" "$keep_daily"
  rotate "$dir/weekly" "$((keep_weekly * 7))"
fi

if [[ $dry_run == 0 ]]; then
  # The .env and the userbot session are full access to the shop and to the customer's own Telegram
  # account: they only ever leave this host encrypted (the sealed session may leave only this way, ADR 0025).
  # Dated names: the target keeps every one and never has a file overwritten.
  today=$(TZ=$tz date +%F)
  if [[ -r $BACKUP_ENV_FILE ]]; then
    age -r "$recipient" -o "$dir/secrets/env-$today.age" "$BACKUP_ENV_FILE"
  else
    log "WARN: $BACKUP_ENV_FILE not readable"
    skipped+=(env-file)
  fi
  session=$(cfg BACKUP_USERBOT_SESSION)
  if [[ -n $session && -r $session ]]; then
    age -r "$recipient" -o "$dir/secrets/userbot-session-$today.age" "$session"
  else
    log 'WARN: no userbot session file (BACKUP_USERBOT_SESSION unset or missing)'
    skipped+=(userbot-session)
  fi
  rotate "$dir/secrets" 60

  # Private receipts: one age file per receipt, in a local tree that mirrors media/private. Only new or
  # changed files are encrypted again (modification time), so the rsync below stays incremental.
  if [[ -d $files/private ]]; then
    while IFS= read -r -d '' src; do
      rel=${src#"$files/private/"}
      enc="$dir/private-enc/$rel.age"
      if [[ ! -e $enc || $src -nt $enc ]]; then
        install -d -m 700 "$(dirname "$enc")"
        age -r "$recipient" -o "$enc.partial" "$src" </dev/null
        mv "$enc.partial" "$enc"
        touch -r "$src" "$enc"
      fi
    done < <(find "$files/private" -type f -print0)
    # Purge: an encrypted copy whose source is gone (a deleted receipt) goes too, never more than BACKUP_MAX_PURGE.
    gone=()
    while IFS= read -r -d '' e; do
      rel=${e#"$dir/private-enc/"}
      [[ -e $files/private/${rel%.age} ]] || gone+=("$e")
    done < <(find "$dir/private-enc" -type f -name '*.age' -print0)
    if ((${#gone[@]} > max_purge)); then die "would purge ${#gone[@]} encrypted receipts (limit $max_purge): is the files volume mounted?"; fi
    for e in "${gone[@]}"; do rm -f -- "${e:?}"; done
    find "$dir/private-enc" -mindepth 1 -type d -empty -delete
  else
    log "WARN: $files/private not found"
    skipped+=(private-receipts)
  fi
fi

target=$(cfg BACKUP_RSYNC_TARGET)
if [[ -z $target ]]; then
  log 'WARN: BACKUP_RSYNC_TARGET is not set: the second copy is skipped (the target is pending, ADR 0025)'
  skipped+=(second-copy)
else
  need rsync 'apt install rsync'
  target=${target%/}
  # ssh_for KEYFILE: key-only, bounded waits; the key path is quoted for rsync's -e
  ssh_for() {
    local cmd='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=4'
    [[ -z $1 ]] || cmd+=" -i $(printf '%q' "$1")"
    printf '%s' "$cmd"
  }
  key=$(cfg BACKUP_SSH_KEY)
  key_private=$(cfg BACKUP_SSH_KEY_PRIVATE "$key")
  target_private=$(cfg BACKUP_RSYNC_TARGET_PRIVATE "$target/private")
  common=(-a --mkpath --timeout=600)
  if [[ $dry_run == 1 ]]; then
    common+=(--dry-run --itemize-changes)
    log 'dry run: nothing is sent'
  fi
  # Dumps and secrets: ADD ONLY. No --delete, never overwrite (--ignore-existing): a rebuilt or
  # compromised VPS cannot wipe or replace what is already off-host. The target rotates by date itself
  # (offsite-rotate.sh) and should also refuse deletes for this key (rrsync -no-del), see the run guide.
  add_only=("${common[@]}" --ignore-existing -e "$(ssh_for "$key")")
  for part in daily:dumps/daily weekly:dumps/weekly secrets:secrets; do
    # a dry run on a fresh setup has no local folders yet
    [[ -d $dir/${part%%:*} ]] || continue
    rsync "${add_only[@]}" "$dir/${part%%:*}/" "$target/${part#*:}/"
  done
  # Public photos are not secret and can be rebuilt: plain, add-only.
  if [[ -d $files/public ]]; then rsync "${add_only[@]}" "$files/public/" "$target/media/public/"; fi
  # Encrypted receipts: a mirror, so a purge reaches the copy, within this tree only and capped.
  if [[ -d $dir/private-enc ]]; then
    rsync "${common[@]}" -e "$(ssh_for "$key_private")" --delete --max-delete="$max_purge" \
      "$dir/private-enc/" "$target_private/"
  fi
fi

if [[ $dry_run == 0 ]]; then
  date -u +%FT%TZ >"$dir/last-success"
  report_to_api "${skipped[@]}"
fi
log "backup finished (dry-run=$dry_run, skipped: ${skipped[*]:-none})"

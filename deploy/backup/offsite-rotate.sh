#!/usr/bin/env bash
# Runs ON THE SECOND LOCATION (daily, from its own cron), never from the VPS: the VPS only adds files
# there. Deletes dumps and secrets older than their keep time, by the date in the file name.
#   offsite-rotate.sh /srv/lummi            (layout: dumps/daily, dumps/weekly, secrets)
# Keeps 14 days of daily dumps, 8 weeks of weekly dumps, 60 days of secrets; override with
# KEEP_DAILY_DAYS, KEEP_WEEKLY_DAYS, KEEP_SECRETS_DAYS. Never touches anything else.
set -euo pipefail
root=${1:?give the backup root, e.g. /srv/lummi}
tz=Asia/Tashkent
prune() {
  local folder=${1:?} days=${2:?} cutoff name day
  [[ -d $folder ]] || return 0
  cutoff=$(TZ=$tz date -d "-$days days" +%F)
  while IFS= read -r name; do
    day=$(grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' <<<"$name" | head -n 1)
    if [[ -n $day && $day < $cutoff ]]; then rm -f -- "${folder:?}/${name:?}"; echo "removed $folder/$name"; fi
  done < <(find "$folder" -maxdepth 1 -type f -printf '%f\n')
}
prune "$root/dumps/daily" "${KEEP_DAILY_DAYS:-14}"
prune "$root/dumps/weekly" "${KEEP_WEEKLY_DAYS:-56}"
prune "$root/secrets" "${KEEP_SECRETS_DAYS:-60}"

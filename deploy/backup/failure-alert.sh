#!/usr/bin/env bash
# Started by systemd (OnFailure= of lummi-backup.service) when the backup failed for ANY reason: a
# command error, `die`, the timeout, a kill. Sends a fixed text, no paths and no data (ADR 0035).
set -uo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$here/lib.sh"
export BACKUP_ENV_FILE=${BACKUP_ENV_FILE:-/opt/lummi/.env}
telegram_alert "Бэкап LUMMI не удался ($(hostname)). Смотрите: journalctl -u lummi-backup -n 50."

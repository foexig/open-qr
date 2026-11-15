#!/usr/bin/env sh
# Restore a dump created by backup.sh. This REPLACES all current data.
set -eu
cd "$(dirname "$0")"
[ $# -eq 1 ] && [ -f "$1" ] || { echo "Usage: $0 backups/open-qr-YYYYMMDD-HHMMSS.dump" >&2; exit 1; }
printf 'This replaces ALL current open-qr data with %s. Type "yes" to continue: ' "$1"
read -r answer
[ "$answer" = yes ] || { echo "Aborted."; exit 1; }
docker compose stop app
docker compose cp "$1" db:/tmp/restore.dump
docker compose exec -T db pg_restore -U openqr -d openqr --clean --if-exists --no-owner /tmp/restore.dump
docker compose exec -T db rm -f /tmp/restore.dump
docker compose start app
echo "Restore complete."

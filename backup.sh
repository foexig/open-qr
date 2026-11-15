#!/usr/bin/env sh
# Create a compressed PostgreSQL dump in ./backups (the app must be running).
set -eu
cd "$(dirname "$0")"
mkdir -p backups
file="open-qr-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U openqr -d openqr -Fc -f "/tmp/$file"
docker compose cp "db:/tmp/$file" "backups/$file"
docker compose exec -T db rm -f "/tmp/$file"
chmod 600 "backups/$file"
echo "Backup written to backups/$file"

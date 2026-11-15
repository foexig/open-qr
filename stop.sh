#!/usr/bin/env sh
# Stop open-qr. Data stays in the Docker volume.
set -eu
cd "$(dirname "$0")"
docker compose down
echo "open-qr stopped. Your data is kept in the 'db-data' volume."

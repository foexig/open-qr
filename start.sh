#!/usr/bin/env sh
# Build and start open-qr with Docker Compose.
set -eu
cd "$(dirname "$0")"

die() { printf 'Error: %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "Docker is not running (or you lack permission to use it)."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required ('docker compose')."

if [ ! -f .env ]; then
  echo "Creating .env from .env.example with a random database password..."
  if command -v openssl >/dev/null 2>&1; then
    pw=$(openssl rand -hex 24)
  else
    pw=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
  fi
  sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$pw/" .env.example > .env
  chmod 600 .env
fi

env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- ; }
port=$(env_value APP_PORT); port=${port:-8000}
base=$(env_value PUBLIC_BASE_URL); base=${base:-http://localhost:$port}

echo "Building and starting containers..."
docker compose up -d --build

printf 'Waiting for open-qr to become healthy'
cid=$(docker compose ps -q app)
i=0
while :; do
  state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)
  [ "$state" = healthy ] && break
  if [ "$state" = unhealthy ] || [ "$state" = exited ] || [ $i -ge 90 ]; then
    echo; echo "open-qr did not start (state: $state). Last log lines:" >&2
    docker compose logs --tail 40 app >&2
    exit 1
  fi
  printf '.'; i=$((i + 1)); sleep 2
done
echo

echo
echo "open-qr is running:  http://localhost:$port"
[ "$base" != "http://localhost:$port" ] && echo "Public base URL:     $base"
docker compose exec -T app python -m app.cli setup-info || true
echo
echo "Stop with ./stop.sh   Logs: docker compose logs -f app"

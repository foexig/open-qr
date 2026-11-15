#!/bin/sh
# Apply database migrations, then start the web server.
set -eu

attempt=1
until alembic upgrade head; do
  if [ "$attempt" -ge 15 ]; then
    echo "entrypoint: database migrations failed after $attempt attempts" >&2
    exit 1
  fi
  echo "entrypoint: database not ready, retrying in 2s ($attempt/15)" >&2
  attempt=$((attempt + 1))
  sleep 2
done

# One worker on purpose: the login rate limiter and setup token live in process memory.
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
  --no-server-header

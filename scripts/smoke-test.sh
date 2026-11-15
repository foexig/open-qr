#!/usr/bin/env sh
# End-to-end check of the production Docker setup: build, start, migrate,
# first-run setup, create a QR code, follow the redirect, verify the scan.
# Uses a separate Compose project and port so it never touches your data.
set -eu
cd "$(dirname "$0")/.."

PORT=${SMOKE_PORT:-18000}
work=$(mktemp -d)
envfile="$work/env"
jar="$work/cookies"
cat > "$envfile" <<ENV
POSTGRES_PASSWORD=smoke-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
PUBLIC_BASE_URL=http://localhost:$PORT
APP_PORT=$PORT
ENV
dc() { docker compose -p open-qr-smoke --env-file "$envfile" "$@"; }
cleanup() { dc down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

fail() { echo "SMOKE TEST FAILED: $1" >&2; dc logs --tail 50 app >&2 || true; exit 1; }
json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

dc up -d --build
base="http://127.0.0.1:$PORT"
i=0
until curl -fsS "$base/healthz" >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -ge 60 ] && fail "app never became healthy"; sleep 2
done
echo "healthz ok"

token=$(dc exec -T app python -m app.cli setup-info | sed -n 's/^SETUP TOKEN: //p')
[ -n "$token" ] || fail "no setup token"

csrf=$(curl -fsS -c "$jar" -H 'Content-Type: application/json' \
  -d "{\"setup_token\":\"$token\",\"username\":\"admin\",\"password\":\"smoke-test-password\"}" \
  "$base/api/auth/setup" | json '["csrf_token"]') || fail "setup failed"
echo "setup ok"

curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"name":"x","target_url":"https://example.com"}' "$base/api/qr-codes" | grep -q 401 \
  || fail "unauthenticated create was not rejected"

qr=$(curl -fsS -b "$jar" -H "X-CSRF-Token: $csrf" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke","target_url":"https://example.com/smoke"}' "$base/api/qr-codes") \
  || fail "create failed"
code=$(echo "$qr" | json '["code"]')
id=$(echo "$qr" | json '["id"]')
echo "created /r/$code"

loc=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$base/r/$code")
[ "$loc" = "302 https://example.com/smoke" ] || fail "redirect returned: $loc"
curl -fsS -b "$jar" -o "$work/qr.png" "$base/api/qr-codes/$id/image.png" || fail "png download"
head -c 8 "$work/qr.png" | od -An -tx1 | grep -q "89 50 4e 47" || fail "not a PNG"

total=$(curl -fsS -b "$jar" "$base/api/qr-codes/$id/stats" | json '["total"]')
[ "$total" = 1 ] || fail "expected 1 scan, got $total"

# Data survives a restart (persistent volume, idempotent migrations).
dc restart app >/dev/null
i=0
until curl -fsS "$base/healthz" >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -ge 60 ] && fail "app did not come back after restart"; sleep 2
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/r/$code")" = 302 ] || fail "code lost after restart"

echo "SMOKE TEST PASSED"

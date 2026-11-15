#!/usr/bin/env sh
# Run the test suite in Docker against a throwaway PostgreSQL.
set -eu
cd "$(dirname "$0")/.."
status=0
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests || status=$?
docker compose -f docker-compose.test.yml down -v --remove-orphans >/dev/null 2>&1 || true
exit "$status"

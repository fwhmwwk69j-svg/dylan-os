#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-test}" in
 start)
  docker network inspect dylan-security >/dev/null 2>&1 || docker network create dylan-security >/dev/null
  docker run -d --network=dylan-security --name dylan-security-db --label dev.dylan.synthetic=true -e POSTGRES_PASSWORD=synthetic-test-only -p 127.0.0.1:55432:5432 postgres:17-alpine >/dev/null
  for attempt in {1..30}; do if docker exec dylan-security-db pg_isready -U postgres >/dev/null; then exit 0; fi; sleep 1; done
  echo 'PostgreSQL failed to become ready' >&2; exit 1 ;;
 stop) docker rm -f dylan-security-db >/dev/null ;;
 test)
  if [[ "$(docker inspect --format '{{index .Config.Labels "dev.dylan.synthetic"}}' dylan-security-db)" != "true" ]]; then echo 'Refusing a database without the synthetic test label' >&2; exit 1; fi
  DYLAN_DB_URL=postgresql://postgres:synthetic-test-only@127.0.0.1:55432/postgres DYLAN_DISPOSABLE_DB=1 node --test scripts/database-security.test.mjs ;;
 *) echo 'Use start, test, or stop' >&2; exit 1 ;;
esac

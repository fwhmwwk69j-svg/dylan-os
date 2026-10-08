#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-start}" in
 start)
  docker run -d --name dylan-security-api --network=dylan-security -p 127.0.0.1:55433:3000 \
   -e PGRST_DB_URI=postgresql://authenticator:synthetic-test-only@dylan-security-db:5432/postgres \
   -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
   -e PGRST_JWT_SECRET=dylan-local-synthetic-jwt-secret-not-for-hosted-staging \
   postgrest/postgrest:v13.0.7 >/dev/null ;;
 stop) docker rm -f dylan-security-api >/dev/null ;;
 *) echo 'Use start or stop' >&2; exit 1 ;;
esac

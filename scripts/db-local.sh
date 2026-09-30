#!/usr/bin/env bash
# Creates (or recreates) a local database with the Supabase shim, all
# migrations and optional sample players. For local testing only.
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:local [dbname] [--sample]
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB="${1:-auction_dev}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
DB_URL="${ADMIN_URL%/*}/$DB"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/sql/supabase-shim.sql
for f in supabase/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
if [[ "${2:-}" == "--sample" ]]; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/sample-players.sql
fi
echo "Ready: $DB_URL"

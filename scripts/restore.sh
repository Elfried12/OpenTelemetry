#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Restoring $1. Database objects included in the backup will be replaced."
docker compose --project-directory "$ROOT_DIR" --env-file "$ROOT_DIR/.env" \
  -f "$ROOT_DIR/compose.yml" exec -T postgres sh -c '
    export PGPASSWORD="$POSTGRES_PASSWORD"
    psql --host=127.0.0.1 --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" --no-psqlrc --set=ON_ERROR_STOP=1 \
      --single-transaction
  ' < "$1"

echo "Restore completed."

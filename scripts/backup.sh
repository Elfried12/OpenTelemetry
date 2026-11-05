#!/usr/bin/env bash
set -euo pipefail
set -o noclobber

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${1:-$ROOT_DIR/backups/backup-$(date -u +%Y%m%dT%H%M%SZ).sql}"

umask 077
mkdir -p "$(dirname "$OUTPUT")"

docker compose --project-directory "$ROOT_DIR" --env-file "$ROOT_DIR/.env" \
  -f "$ROOT_DIR/compose.yml" exec -T postgres sh -c '
    export PGPASSWORD="$POSTGRES_PASSWORD"
    pg_dump --host=127.0.0.1 --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" --format=plain --clean --if-exists \
      --no-owner --no-privileges
  ' > "$OUTPUT"

echo "Backup saved to $OUTPUT"

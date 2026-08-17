#!/usr/bin/env bash
# Restore a Lockpad Postgres backup produced by backup.sh.
# Usage: ./scripts/restore.sh backups/lockpad-YYYYMMDD-HHMMSS.sql.gz
#
# WARNING: this overwrites the current database contents.
set -euo pipefail

DUMP="${1:?Usage: restore.sh <path-to-.sql.gz>}"
[ -f "$DUMP" ] || { echo "File not found: $DUMP" >&2; exit 1; }

read -r -p "This will overwrite the '${POSTGRES_DB:-lockpad}' database. Continue? [y/N] " ans
[ "$ans" = "y" ] || { echo "Aborted."; exit 1; }

gunzip -c "$DUMP" | docker compose exec -T postgres \
  psql -U "${POSTGRES_USER:-lockpad}" -d "${POSTGRES_DB:-lockpad}"

echo "Restore complete from $DUMP"

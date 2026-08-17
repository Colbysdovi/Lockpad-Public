#!/usr/bin/env bash
# Nightly Postgres backup for Lockpad. Dumps the DB to a local folder on the NAS
# (never a cloud service). Keeps the last 14 dumps.
#
# Cron example (2:30am daily), on the NAS host:
#   30 2 * * *  /path/to/lockpad/scripts/backup.sh >> /var/log/lockpad/backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${LOCKPAD_BACKUP_DIR:-$(dirname "$0")/../backups}"
RETENTION="${LOCKPAD_BACKUP_RETENTION:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/lockpad-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump from the postgres container via compose, gzip to the NAS folder.
# Uses the same env as docker-compose (.env). Adjust the service name if needed.
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-lockpad}" -d "${POSTGRES_DB:-lockpad}" \
  | gzip > "$OUT"

echo "[$(date -Iseconds)] backup written: $OUT ($(du -h "$OUT" | cut -f1))"

# Prune old backups beyond the retention count.
ls -1t "$BACKUP_DIR"/lockpad-*.sql.gz 2>/dev/null | tail -n +"$((RETENTION + 1))" | xargs -r rm -f
echo "[$(date -Iseconds)] pruned to last $RETENTION backups"

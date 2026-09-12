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
# Written here first, and only MOVED to $OUT once it has been checked. See below.
# The leading dot keeps it out of the lockpad-*.sql.gz glob, so a partial file can
# never be counted as a backup or deleted as one.
TMP="$BACKUP_DIR/.lockpad-$STAMP.sql.gz.partial"

mkdir -p "$BACKUP_DIR"

# ── Why this writes to a temp file instead of straight to $OUT ────────────────
#
# It used to be `pg_dump … | gzip > "$OUT"`, and that is a data-loss bug wearing a
# one-liner's clothes. The shell creates $OUT when it sets up the redirect — BEFORE
# pg_dump runs — so any failure at all (Postgres down, container renamed, wrong
# credentials, disk full, script run on a machine with no docker) leaves behind a
# perfectly well-formed .sql.gz containing nothing.
#
# That file then lies twice. It looks like the most recent backup, so "restore the
# newest one" restores an empty database. And because the prune below keeps the last
# N by name, empty files OCCUPY RETENTION SLOTS: fourteen consecutive failed nightly
# runs would silently evict every real backup on the box, and the log would say
# "backup written" fourteen times while doing it.
#
# This is not hypothetical. A 20-byte lockpad-20260907-001855.sql.gz — valid gzip,
# zero bytes inside — was produced on 7 Sep 2026 by running this script on a machine
# with no docker installed, and sat in the backups folder looking newer than every
# real dump there.
#
# So: dump to $TMP, prove it is a real dump, and only then move it into place. The
# move is atomic within a filesystem, so $OUT never exists in a half-written state.
trap 'rm -f "$TMP"' EXIT

# Dump from the postgres container via compose, gzip to the NAS folder.
# Uses the same env as docker-compose (.env). Adjust the service name if needed.
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-lockpad}" -d "${POSTGRES_DB:-lockpad}" \
  | gzip > "$TMP"

# Does it actually contain a dump?
#
# `set -e` and `pipefail` already catch a pg_dump that EXITS non-zero. They do not
# catch one that exits 0 having written nothing useful, which is the failure that
# matters here — so the content is checked rather than the exit code.
#
# Counted with `wc -c`, which reads the whole stream, rather than `head`, which would
# close the pipe early and make gzip die of SIGPIPE — turning a good backup into a
# failed one under pipefail. The subshell drops pipefail so that a truncated archive
# reports 0 bytes instead of killing the script before it can say why.
BYTES="$( set +o pipefail; gzip -cd "$TMP" 2>/dev/null | wc -c | tr -d ' ' )"
# A real dump carries the schema at minimum and clears this comfortably; an empty or
# truncated one does not come close.
if [ "${BYTES:-0}" -lt 1024 ]; then
  echo "[$(date -Iseconds)] BACKUP FAILED: dump decompressed to ${BYTES:-0} bytes." >&2
  echo "  Nothing has been written to $BACKUP_DIR — the previous backups are untouched." >&2
  echo "  Check that the postgres container is running and that this is being run from" >&2
  echo "  the Lockpad directory on the machine hosting it." >&2
  exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT

echo "[$(date -Iseconds)] backup written: $OUT ($(du -h "$OUT" | cut -f1), $BYTES bytes uncompressed)"

# Prune old backups beyond the retention count. Safe to do only because a failed run
# above exits before ever creating a file here — so everything this counts is real.
ls -1t "$BACKUP_DIR"/lockpad-*.sql.gz 2>/dev/null | tail -n +"$((RETENTION + 1))" | xargs -r rm -f
echo "[$(date -Iseconds)] pruned to last $RETENTION backups"

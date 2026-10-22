#!/usr/bin/env bash
#
# Backs up the instance this checkout runs: the database as a pg_dump, and the uploaded media, into
# one dated directory under BACKUP_DIR — then proves the dump restores. Run nightly on the server by
# scripts/systemd/cedo-backup.timer, or by hand. See docs/09-deployment.md, "Backup and restore".
#
# Every backup is restored into a scratch database beside the live one and its row counts compared,
# table by table, with the live database's. A backup that has never been restored is a hope, and a
# dump that cannot be restored is found tonight, not on the day it is needed. A failed check keeps
# the backup and fails the run, so it is seen.
#
# Kept on this machine only: it guards against a bad migration or a mistake, not against losing the
# server (#17).
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-$HOME/backups/cedo}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

cd "$(dirname "$0")/.."
compose() { docker compose "$@"; }
# psql and the Postgres tools inside the db container, as the database's own user.
db() { compose exec -T db "$@"; }

# Every table in `public`, with its exact row count — a query, so the two sides count alike.
count_rows() {
  db sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -tA -F ' ' -v ON_ERROR_STOP=1" <<'SQL'
select table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
SQL
}

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
partial="$BACKUP_DIR/.partial-$stamp"
mkdir -p "$partial"
chmod 700 "$BACKUP_DIR"

echo "Backing up to $BACKUP_DIR/$stamp ($(git log --oneline -1 2>/dev/null || echo 'no git'))"
# The container's own credentials: nothing secret lives in this script or its arguments.
db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$partial/cedo.dump"
# The uploads volume, read through the container that mounts it — no volume name to guess.
compose exec -T api tar czf - -C /data/uploads . >"$partial/uploads.tar.gz"
count_rows '"$POSTGRES_DB"' >"$partial/rows.txt"

# Only a complete backup gets a dated name.
mv "$partial" "$BACKUP_DIR/$stamp"
backup="$BACKUP_DIR/$stamp"
echo "  cedo.dump $(du -h "$backup/cedo.dump" | cut -f1), uploads.tar.gz $(du -h "$backup/uploads.tar.gz" | cut -f1)"

# The proof: restore into a scratch database, count, compare, drop.
scratch=cedo_restore_check
db sh -c "PGOPTIONS='-c client_min_messages=warning' dropdb -U \"\$POSTGRES_USER\" --if-exists $scratch && createdb -U \"\$POSTGRES_USER\" $scratch"
trap 'db sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists '"$scratch"'" >/dev/null 2>&1 || true' EXIT
db sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $scratch --no-owner --exit-on-error" <"$backup/cedo.dump"
count_rows "$scratch" >"$backup/restored-rows.txt"
if ! diff -u "$backup/rows.txt" "$backup/restored-rows.txt" >"$backup/restore-check.diff"; then
  echo "RESTORE CHECK FAILED: the restored copy's row counts differ — see $backup/restore-check.diff" >&2
  echo "(A write between the dump and the count also differs; run again to tell the two apart.)" >&2
  exit 1
fi
rm "$backup/restored-rows.txt" "$backup/restore-check.diff"
echo "  restored into a scratch database: $(($(wc -l <"$backup/rows.txt"))) tables, every row count matching"

# Rotation: dated directories older than KEEP_DAYS, and partials a failed run left behind.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '.partial-*' ! -path "$backup" -mmin +60 -exec rm -rf {} +
echo "  $(($(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l))) backups kept (${KEEP_DAYS} days)"

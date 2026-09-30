#!/usr/bin/env bash
# On the server (cron, daily): consistent DB copy + media + import drafts into
# backups/greek-data-<date>.tar.gz; the newest KEEP archives are kept (default 14).
# Same format as pack-data.sh, so deploy/restore-data.sh restores either.
#   deploy/backup.sh
# Copies on the same disk don't survive a lost server: fetch them with deploy/pull-backups.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP=${KEEP:-14}

stamp=$(date +%Y%m%d-%H%M%S)
out="backups/greek-data-$stamp.tar.gz"
stage="data/backup-stage-$stamp"   # inside ./data so the container can write there
trap 'rm -rf "$stage"' EXIT

mkdir -p backups
docker compose exec -T backend python -m app.cli backup "/app/$stage/data/greek.db" >/dev/null

parts=(media)
[ -d data/imports ] && parts+=(data/imports)
tar -czf "$out.part" -C "$stage" data/greek.db -C "$PWD" "${parts[@]}"
mv "$out.part" "$out"
chmod 600 "$out"

ls -1t backups/greek-data-*.tar.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "$(date '+%F %T') бэкап: $out ($(du -h "$out" | cut -f1))"

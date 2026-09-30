#!/usr/bin/env bash
# On the server, in the project folder: put a data archive in place (from pack-data.sh or
# backup.sh) — data/greek.db, data/imports/, media/.
#   deploy/restore-data.sh backups/greek-data-<date>.tar.gz [--force]
# Without --force it refuses to replace an existing DB. The site is stopped while restoring.
set -euo pipefail
cd "$(dirname "$0")/.."

archive=${1:?"Укажите архив: deploy/restore-data.sh backups/<файл>.tar.gz [--force]"}
force=${2:-}
[ -f "$archive" ] || { echo "Нет файла $archive" >&2; exit 1; }
tar -tzf "$archive" | grep -qx 'data/greek.db' || { echo "В архиве нет data/greek.db" >&2; exit 1; }
if [ -f data/greek.db ] && [ "$force" != "--force" ]; then
  echo "data/greek.db уже есть. Чтобы заменить (текущая база будет сохранена рядом), добавьте --force" >&2
  exit 1
fi

docker compose stop backend 2>/dev/null || true
if [ -f data/greek.db ]; then
  keep="backups/before-restore-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$keep"
  mv data/greek.db* "$keep"/
  [ -d media ] && mv media "$keep"/
  [ -d data/imports ] && mv data/imports "$keep"/
  echo "Прежние данные: $keep"
fi

mkdir -p data media
tar -xzf "$archive"
# The backend runs as uid 1000 inside the container and must be able to write here.
if [ "$(id -u)" = 0 ]; then
  chown -R 1000:1000 data media
elif [ "$(id -u)" != 1000 ]; then
  echo "Внимание: файлы должны принадлежать uid 1000 — выполните: sudo chown -R 1000:1000 data media" >&2
fi
echo "Восстановлено из $archive. Запуск: docker compose up -d"

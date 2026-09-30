#!/usr/bin/env bash
# On the laptop: pack the data that is not in git (DB, media, import drafts) for the server.
#   deploy/pack-data.sh            -> backups/greek-data-<date>.tar.gz
# The DB is copied with the SQLite backup API, so the dev server may keep running.
# Unpack on the server with deploy/restore-data.sh. The archive holds the group's users
# (password hashes) and the textbook pictures: keep it private.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f data/greek.db ] || { echo "Нет data/greek.db — нечего переносить" >&2; exit 1; }
[ -x backend/.venv/bin/python ] || { echo "Нет backend/.venv — сначала make setup" >&2; exit 1; }

stamp=$(date +%Y%m%d-%H%M%S)
out="backups/greek-data-$stamp.tar.gz"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir -p backups "$stage/data"
(cd backend && .venv/bin/python -m app.cli backup "$stage/data/greek.db")

parts=(media)
[ -d data/imports ] && parts+=(data/imports)
mkdir -p media
COPYFILE_DISABLE=1 tar -czf "$out" --exclude .DS_Store -C "$stage" data/greek.db -C "$PWD" "${parts[@]}"

echo "Готово: $out ($(du -h "$out" | cut -f1))"
echo "На сервер: scp $out <user>@<server>:greek/backups/"

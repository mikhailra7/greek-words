#!/usr/bin/env bash
# On the laptop: copy the server's backups into ./backups (only new files are fetched).
#   deploy/pull-backups.sh <user>@<server> [folder on the server, default: greek]
set -euo pipefail
cd "$(dirname "$0")/.."
host=${1:?"Укажите сервер: deploy/pull-backups.sh <user>@<server>"}
dir=${2:-greek}
mkdir -p backups
rsync -av --ignore-existing "$host:$dir/backups/greek-data-*.tar.gz" backups/

#!/usr/bin/env bash
# On the server: take the latest main from GitHub, rebuild and restart. Migrations run when
# the backend starts. A backup is made first.
#   deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
if docker compose ps --status running --services 2>/dev/null | grep -x backend >/dev/null; then
  deploy/backup.sh
fi
git pull --ff-only
# --force-recreate: without it Compose kept the backend on the old image after a rebuild.
docker compose up -d --build --force-recreate --wait
docker image prune -f >/dev/null
docker compose ps

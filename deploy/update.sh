#!/usr/bin/env bash
# On the server: take the latest main from GitHub, rebuild and restart. Migrations run when
# the backend starts. A backup is made first.
#   deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
if docker compose ps --status running --services 2>/dev/null | grep -qx backend; then
  deploy/backup.sh
fi
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps

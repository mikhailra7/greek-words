#!/usr/bin/env bash
# On the server: take the latest main from GitHub, rebuild and restart. Migrations run when
# the backend starts. A backup is made first.
#   deploy/update.sh
# Everything is inside main(): git pull rewrites this very file, and bash reads a script as it
# goes — without the function the rest would run from the new file at the old offset.
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  if docker compose ps --status running --services 2>/dev/null | grep -x backend >/dev/null; then
    deploy/backup.sh
  fi
  git pull --ff-only
  # --force-recreate: without it Compose kept the backend on the old image after a rebuild.
  docker compose up -d --build --force-recreate --wait
  docker image prune -f >/dev/null
  docker compose ps
}

main "$@"
exit

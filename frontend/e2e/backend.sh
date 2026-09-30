#!/bin/sh
# Fresh backend for e2e tests: own SQLite DB and media folders under data/e2e, no TTS.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E2E="$ROOT/data/e2e"
rm -rf "$E2E" && mkdir -p "$E2E"
export DATABASE_URL="sqlite:///$E2E/e2e.db"
export MEDIA_DIR="$E2E/media"
export IMPORTS_DIR="$E2E/imports"
export TTS_ENABLED=false
export MAX_USERS=20
cd "$ROOT/backend"
.venv/bin/alembic upgrade head >/dev/null
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001

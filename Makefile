BACKEND := backend
VENV := $(BACKEND)/.venv
PY := $(VENV)/bin/python

# Prefer the project-local Node (unpacked into .tools/node) when present.
export PATH := $(CURDIR)/.tools/node/bin:$(PATH)

.PHONY: setup setup-backend setup-frontend dev backend frontend migrate test e2e lint lint-backend lint-frontend fmt build pack-data

setup: setup-backend setup-frontend

setup-backend:
	cd $(BACKEND) && python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -e ".[dev]"
	@test -f .env || cp .env.example .env

setup-frontend:
	cd frontend && npm install

# Backend and frontend together; Ctrl+C stops both.
dev:
	@trap 'kill 0' INT TERM; $(MAKE) backend & $(MAKE) frontend & wait

backend: migrate
	cd $(BACKEND) && .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# --host exposes the dev server on the local network so a phone on the same Wi-Fi can open it.
frontend:
	cd frontend && npm run dev -- --host 0.0.0.0 --port 5173

migrate:
	cd $(BACKEND) && .venv/bin/alembic upgrade head

test:
	cd $(BACKEND) && .venv/bin/pytest -q

# Browser tests: own backend on :8001 (DB in data/e2e), frontend on :5174. Chromium lives in .tools.
e2e:
	cd frontend && PLAYWRIGHT_BROWSERS_PATH=$(CURDIR)/.tools/ms-playwright npx playwright test

lint: lint-backend lint-frontend

lint-backend:
	cd $(BACKEND) && .venv/bin/ruff check . && .venv/bin/ruff format --check .

lint-frontend:
	@if [ -d frontend/node_modules ]; then cd frontend && npm run lint && npm run format:check; fi

fmt:
	cd $(BACKEND) && .venv/bin/ruff check --fix . && .venv/bin/ruff format .
	@if [ -d frontend/node_modules ]; then cd frontend && npm run format; fi

# Production build of the SPA into frontend/dist (the server builds it inside Docker).
build:
	cd frontend && npm run build

# DB + media + import drafts -> backups/greek-data-<date>.tar.gz, for moving to the server.
pack-data:
	deploy/pack-data.sh

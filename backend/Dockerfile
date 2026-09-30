# Backend image. Build context is the repository root (it needs docs/prompts too):
#   docker compose build backend
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Same layout as the repository, so the default paths in app/config.py (data/, media/,
# docs/prompts/ next to backend/) work unchanged: /app/backend, /app/data, /app/media.
WORKDIR /app/backend

# Dependencies first: this layer is rebuilt only when pyproject.toml changes.
COPY backend/pyproject.toml ./
RUN mkdir app && touch app/__init__.py && pip install -e . && rm -rf app

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY docs/prompts /app/docs/prompts

# uid 1000 owns ./data and ./media on the server (see deploy/README.md).
RUN useradd --uid 1000 --create-home app \
    && mkdir -p /app/data /app/media \
    && chown app:app /app/data /app/media
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

# One process on purpose: the login rate limiter and the TTS queues live in memory.
# --proxy-headers: the client IP comes from Caddy's X-Forwarded-For, otherwise every visitor
# looks like Caddy and 10 wrong passwords from anyone would lock the whole group out.
# Trusting any sender is safe here because port 8000 is reachable only inside the compose network.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]

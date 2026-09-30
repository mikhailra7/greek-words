# Web image: builds the SPA and serves it with Caddy, which also proxies /api and /media to
# the backend and gets the HTTPS certificate. Build context is the repository root:
#   docker compose build web
FROM node:24-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv

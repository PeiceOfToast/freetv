# Stage 1: build the SPA. Stage 2: serve dist/ with Caddy (see Caddyfile).
# Build context is apps/web. The compose file overrides the Caddyfile at runtime
# with infra/caddy/ (bind mount); this copy is the image default.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443

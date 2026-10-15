# Fly web app: the published FreeTV web image (static SPA + Caddy) with the Fly Caddyfile.
# UNTESTED. Build context is this directory.
ARG FREETV_TAG=latest
FROM ghcr.io/freetv/freetv-web:${FREETV_TAG}
COPY Caddyfile /etc/caddy/Caddyfile

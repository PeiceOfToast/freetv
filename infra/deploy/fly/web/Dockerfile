# Fly web app: the published FreeTV web image (static SPA + Caddy) with the Fly Caddyfile.
# UNTESTED. Build context is this directory.
ARG FREETV_TAG=latest
# Forks: fly deploy --build-arg FREETV_OWNER=<your-lowercase-owner>
ARG FREETV_OWNER=peiceoftoast
FROM ghcr.io/${FREETV_OWNER}/freetv-web:${FREETV_TAG}
COPY Caddyfile /etc/caddy/Caddyfile

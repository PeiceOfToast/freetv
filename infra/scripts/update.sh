#!/usr/bin/env bash
# Update a running FreeTV checkout: pull code, pull images (or build), restart, reload Caddy if
# its config changed, and prune dangling images.
#
#   infra/scripts/update.sh                 pull published images; build locally if they are missing
#   FREETV_BUILD=1 infra/scripts/update.sh  always build from this checkout
#
# Requires a git checkout (not a downloaded zip) and a .env with a real PROXY_SECRET.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ ! -f .env ]]; then
  echo ".env is missing; run: cp .env.example .env && infra/scripts/gen-secret.sh --write" >&2
  exit 1
fi
if grep -q '^PROXY_SECRET=change-me' .env; then
  echo "PROXY_SECRET is still the placeholder; run: infra/scripts/gen-secret.sh --write" >&2
  exit 1
fi

before="$(git rev-parse HEAD)"
git pull --ff-only
after="$(git rev-parse HEAD)"

if [[ "${FREETV_BUILD:-0}" == "1" ]]; then
  docker compose build
elif ! docker compose pull; then
  echo "image pull failed; building from source instead" >&2
  docker compose build
fi

docker compose up -d --remove-orphans

# The Caddy config is a bind mount, so a changed file needs an explicit reload.
if [[ "$before" != "$after" ]] && ! git diff --quiet "$before" "$after" -- infra/caddy; then
  docker compose exec -T web caddy reload --config /etc/caddy/Caddyfile
fi

docker image prune -f >/dev/null
docker compose ps

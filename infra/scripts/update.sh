#!/usr/bin/env bash
# Update a running FreeTV checkout: pull code, pull images (or build), restart, reload Caddy if
# its config changed, and prune dangling images.
#
#   infra/scripts/update.sh                 pull published images; build locally if they are missing
#   FREETV_BUILD=1 infra/scripts/update.sh  always build from this checkout
#
# GITHUB_REPOSITORY_OWNER empty or "local" means nothing is published: the images are always built
# from this checkout and nothing is pulled.
#
# The core services of the active profiles (web and api, plus proxy when its profile is on) are pulled or built and
# restarted first. epg comes last: if its
# pull or build fails, that is a warning and the running epg container is left as it is.
#
# Requires a git checkout (not a downloaded zip) and a .env with a real PROXY_SECRET (and a real
# GRAFANA_ADMIN_PASSWORD when the monitoring profile is enabled). Used by infra/auto-update/ too.
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

# Grafana's password falls back to a placeholder in compose; refuse to run it that way.
grafana_pw="$(grep -E '^GRAFANA_ADMIN_PASSWORD=' .env | tail -n1 | cut -d= -f2- || true)"
if grep -Eq '^COMPOSE_PROFILES=.*monitoring' .env && [[ -z "$grafana_pw" || "$grafana_pw" == change-me* ]]; then
  echo "monitoring profile is enabled but GRAFANA_ADMIN_PASSWORD is unset or a placeholder; set it in .env" >&2
  exit 1
fi

# No owner means no published namespace: never pull, always build.
owner="$(grep -E '^GITHUB_REPOSITORY_OWNER=' .env | tail -n1 | cut -d= -f2- || true)"
build_mode="${FREETV_BUILD:-0}"
if [[ -z "$owner" || "$owner" == local ]]; then
  echo "GITHUB_REPOSITORY_OWNER is empty: building from this checkout, not pulling" >&2
  build_mode=1
fi

before="$(git rev-parse HEAD)"
git pull --ff-only
after="$(git rev-parse HEAD)"

# Services of the active profiles only, split into core and epg.
core=()
has_epg=0
while IFS= read -r svc; do
  [[ -z "$svc" ]] && continue
  if [[ "$svc" == epg ]]; then has_epg=1; else core+=("$svc"); fi
done < <(docker compose config --services)

# Pull (unless building), falling back to a build. Returns non-zero only when the build fails.
prepare() {
  if [[ "$build_mode" == 1 ]]; then
    docker compose build "$@"
  elif ! docker compose pull "$@"; then
    echo "image pull failed for: $*; building from source instead" >&2
    docker compose build "$@"
  fi
}

prepare "${core[@]}"

# Installs from before the api ran as uid 1000 have a root-owned data volume, which the api and epg
# can no longer write to. Hand it to 1000:1000 once; this is a no-op when the owner is already right.
# Only the top-level owner is checked, which is enough: the chown is recursive and runs once.
docker compose run --rm -T --no-deps --user root --entrypoint sh api -c \
  'if [ "$(stat -c %u /data)" != 1000 ]; then chown -R 1000:1000 /data && echo "data volume ownership set to 1000:1000"; fi' \
  || echo "WARNING: could not check or fix the data volume ownership; see docs/TROUBLESHOOTING.md" >&2

docker compose up -d --remove-orphans "${core[@]}"

# The Caddy config is a bind mount, so a changed file needs an explicit reload.
if [[ "$before" != "$after" ]] && ! git diff --quiet "$before" "$after" -- infra/caddy; then
  docker compose exec -T web caddy reload --config /etc/caddy/Caddyfile
fi

if (( has_epg )); then
  if prepare epg && docker compose up -d epg; then
    echo "epg updated"
  else
    echo "WARNING: epg was not updated (pull, build or start failed). The other services are up to date," >&2
    echo "WARNING: and the previous epg container, if any, is still running. Check: docker compose logs epg" >&2
  fi
fi

docker image prune -f >/dev/null
docker compose ps

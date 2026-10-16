#!/usr/bin/env bash
# Install (or remove) the weekly FreeTV update timer. Opt-in: nothing runs until you install it.
#
#   sudo infra/auto-update/install.sh                 timer runs update.sh (pull GHCR images; builds if GITHUB_REPOSITORY_OWNER is empty)
#   sudo infra/auto-update/install.sh --build         timer runs update.sh with FREETV_BUILD=1 (build from this checkout)
#   sudo infra/auto-update/install.sh --dir /opt/freetv --user freetv
#   sudo infra/auto-update/install.sh --uninstall
#   systemctl list-timers freetv-update.timer        next run
#
# Defaults: --dir is the checkout containing this script; --user is the owner of that directory.
# The user must be able to run docker (member of the docker group) and must own the checkout
# (update.sh runs git pull there).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR=/etc/systemd/system
SERVICE=freetv-update.service
TIMER=freetv-update.timer

dir="$ROOT"
user=""
build=0
uninstall=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) build=1; shift ;;
    --dir) dir="${2:?--dir needs a path}"; shift 2 ;;
    --user) user="${2:?--user needs a name}"; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

if [[ "$uninstall" -eq 1 ]]; then
  systemctl disable --now "$TIMER" 2>/dev/null || true
  rm -f "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"
  systemctl daemon-reload
  echo "removed $TIMER and $SERVICE"
  exit 0
fi

command -v systemctl >/dev/null || { echo "systemd is required" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

dir="$(cd "$dir" && pwd)"
if [[ ! -d "$dir/.git" ]]; then
  echo "$dir is not a git checkout; update.sh needs one (git pull)" >&2
  exit 1
fi
if [[ -z "$user" ]]; then
  user="$(stat -c %U "$dir")"
fi
if ! id "$user" >/dev/null 2>&1; then
  echo "user $user does not exist" >&2
  exit 1
fi
if [[ "$user" == root ]]; then
  echo "warning: running the update as root; prefer a dedicated user in the docker group" >&2
elif ! id -nG "$user" | tr ' ' '\n' | grep -qx docker; then
  echo "warning: $user is not in the docker group; the timer will fail until you run: usermod -aG docker $user" >&2
fi
for value in "$dir" "$user"; do
  case "$value" in *'|'*|*' '*) echo "paths and user names must not contain '|' or spaces: $value" >&2; exit 1 ;; esac
done

render() {
  sed -e "s|@FREETV_DIR@|$dir|g" -e "s|@FREETV_USER@|$user|g" -e "s|@FREETV_BUILD@|$build|g" "$1"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
render "$ROOT/infra/auto-update/freetv-update.service.in" > "$tmp/$SERVICE"
cp "$ROOT/infra/auto-update/freetv-update.timer" "$tmp/$TIMER"

if command -v systemd-analyze >/dev/null; then
  systemd-analyze verify "$tmp/$SERVICE" "$tmp/$TIMER" || echo "warning: systemd-analyze reported issues" >&2
fi

install -m 0644 "$tmp/$SERVICE" "$UNIT_DIR/$SERVICE"
install -m 0644 "$tmp/$TIMER" "$UNIT_DIR/$TIMER"
systemctl daemon-reload
systemctl enable --now "$TIMER"

echo "installed: checkout=$dir user=$user build=$build"
systemctl list-timers "$TIMER" --no-pager || true

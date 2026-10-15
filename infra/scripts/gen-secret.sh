#!/usr/bin/env bash
# Generate the shared PROXY_SECRET (HMAC key for api <-> proxy signed URLs).
#
#   infra/scripts/gen-secret.sh            print a new secret to stdout
#   infra/scripts/gen-secret.sh --write    write it into ./.env (refuses to overwrite a real secret)
#   infra/scripts/gen-secret.sh --write --force   replace an existing secret (invalidates signed URLs)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
write=0
force=0
for arg in "$@"; do
  case "$arg" in
    --write) write=1 ;;
    --force) force=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

secret="$(openssl rand -hex 32)"

if [[ "$write" -eq 0 ]]; then
  echo "$secret"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE does not exist; run: cp .env.example .env" >&2
  exit 1
fi

current="$(grep -E '^PROXY_SECRET=' "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
if [[ -n "$current" && "$current" != change-me* && "$force" -eq 0 ]]; then
  echo "PROXY_SECRET is already set; pass --force to replace it" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
if grep -q '^PROXY_SECRET=' "$ENV_FILE"; then
  awk -v s="$secret" '/^PROXY_SECRET=/ { print "PROXY_SECRET=" s; next } { print }' "$ENV_FILE" > "$tmp"
else
  { cat "$ENV_FILE"; echo "PROXY_SECRET=$secret"; } > "$tmp"
fi
# Overwrite in place so the file's owner and mode are preserved.
cat "$tmp" > "$ENV_FILE"
echo "PROXY_SECRET written to $ENV_FILE" >&2

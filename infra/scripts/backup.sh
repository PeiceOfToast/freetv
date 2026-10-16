#!/usr/bin/env bash
# Back up FreeTV state while it keeps running. Nothing is stopped.
#
#   infra/scripts/backup.sh                    writes into ./backups (override with BACKUP_DIR=/path)
#
# Writes three files, named with today's date:
#   catalog-YYYY-MM-DD.db   consistent SQLite snapshot of catalog.db (SQLite online backup API)
#   data-YYYY-MM-DD.tgz     epg/ (guide.xml) and local-blocklist.json from the data volume
#   caddy-YYYY-MM-DD.tgz    TLS certificates and the ACME account (caddy_data volume)
# The catalog is rebuilt from the internet on the next ingest anyway; the guide and certificates are
# the parts that take time to get back. Keep .env with the backups: it holds PROXY_SECRET.
#
# Needs the api and web containers running. Output is not encrypted; store it accordingly.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

dest="${BACKUP_DIR:-$PWD/backups}"
stamp="$(date +%F)"
mkdir -p "$dest"

api_id="$(docker compose ps -q api)"
web_id="$(docker compose ps -q web)"
if [[ -z "$api_id" || -z "$web_id" ]]; then
  echo "api and web must be running (docker compose ps)" >&2
  exit 1
fi

# Helper image: the api image itself, which already has tar. Nothing extra is pulled.
helper="$(docker inspect -f '{{.Config.Image}}' "$api_id")"
me="$(id -u):$(id -g)"

# 1. Catalog. The snapshot is written inside the api container (it has the database) and copied out.
tmp_db="/data/backup-tmp.db"
trap 'docker compose exec -T api rm -f "$tmp_db" >/dev/null 2>&1 || true' EXIT
docker compose exec -T api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/data/catalog.db', { readonly: true, fileMustExist: true });
  db.backup('$tmp_db').then(
    () => { db.close(); console.log('snapshot written'); },
    err => { console.error(err); process.exit(1); }
  );
"
docker compose cp "api:$tmp_db" "$dest/catalog-$stamp.db"

# 2. Guide and blocklist from the data volume. raw/ and catalog.db are left out on purpose.
# Only the paths that exist are archived (the blocklist appears once block-channel.sh has run).
docker run --rm --user "$me" --entrypoint sh --volumes-from "$api_id:ro" -v "$dest:/backup" "$helper" \
  -c "cd /data && tar -czf /backup/data-$stamp.tgz \$(ls -d epg local-blocklist.json 2>/dev/null)"

# 3. Certificates and the ACME account (caddy_data is mounted at /data in the web container).
docker run --rm --user "$me" --entrypoint tar --volumes-from "$web_id:ro" -v "$dest:/backup" "$helper" \
  -czf "/backup/caddy-$stamp.tgz" -C /data .

echo "wrote:"
ls -l "$dest"/catalog-"$stamp".db "$dest"/data-"$stamp".tgz "$dest"/caddy-"$stamp".tgz

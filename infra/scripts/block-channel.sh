#!/usr/bin/env bash
# Hide a channel on this instance, on top of iptv-org's blocklist.
#
#   infra/scripts/block-channel.sh <channel-id>
#
# Appends the id to the api's LOCAL_BLOCKLIST file (default /data/local-blocklist.json in the data
# volume, a JSON array). The file is read at ingest, so the script then asks the api to re-ingest:
# POST /api/admin/ingest, but only when ADMIN_TOKEN is set in .env. Without the token the channel
# disappears on the next scheduled ingest (INGEST_INTERVAL_HOURS).
#
# Needs the api container running. Idempotent: blocking an id twice changes nothing.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ $# -ne 1 || "$1" == -h || "$1" == --help ]]; then
  sed -n '2,11p' "$0"
  exit 2
fi
id="$1"
if [[ ! "$id" =~ ^[A-Za-z0-9._@:+-]{1,200}$ ]]; then
  echo "channel id has unexpected characters: $id" >&2
  exit 2
fi

# Runs inside the api container, so the file path and token come from its environment.
# The id is passed as an argument, never interpolated into the script.
docker compose exec -T api node -e '
  const fs = require("node:fs");
  const file = process.env.LOCAL_BLOCKLIST || "/data/local-blocklist.json";
  const id = process.argv[1];
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (!Array.isArray(list)) throw new Error(file + " must contain a JSON array");
  const already = list.some((x) => (typeof x === "string" ? x : x && x.channel) === id);
  if (!already) {
    list.push(id);
    fs.writeFileSync(file + ".tmp", JSON.stringify(list, null, 2) + "\n");
    fs.renameSync(file + ".tmp", file);
  }
  console.log((already ? "already blocked: " : "blocked: ") + id + " (" + list.length + " entries in " + file + ")");
' "$id"

if grep -Eq '^ADMIN_TOKEN=.+' .env 2>/dev/null; then
  # The token is read inside the container, so it never appears in this process's arguments.
  docker compose exec -T api node -e '
    const token = process.env.ADMIN_TOKEN;
    const port = process.env.PORT || 3000;
    fetch("http://127.0.0.1:" + port + "/api/admin/ingest", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
    })
      .then((r) => { console.log("re-ingest requested: HTTP " + r.status); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error("re-ingest request failed: " + e.message); process.exit(1); });
  '
else
  echo "ADMIN_TOKEN is not set in .env; the change takes effect at the next scheduled ingest." >&2
fi

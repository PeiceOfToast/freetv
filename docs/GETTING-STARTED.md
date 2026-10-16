# Getting started: empty VM to a live site

This is the shortest path. It assumes a fresh Ubuntu 22.04/24.04 VM (x86-64 or ARM64) with ports
80 and 443 reachable from the internet, and a domain name you control. Everything else is optional.
For Oracle's free tier specifically, [DEPLOY-ORACLE.md](DEPLOY-ORACLE.md) covers the console clicks.

## 1. Point your domain at the VM

Create an `A` record (and `AAAA` if you have IPv6) for e.g. `tv.example.com` → the VM's public IP.
Do this first so the record has propagated by the time Caddy asks for a certificate.

## 2. Install Docker

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version          # needs Compose v2 (the plugin), which get.docker.com installs
```

On Oracle images also open the ports in the instance firewall (the cloud security list is not enough):

```sh
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Clone and configure

```sh
sudo mkdir -p /opt/freetv && sudo chown $USER /opt/freetv
git clone https://github.com/<you>/freetv.git /opt/freetv && cd /opt/freetv
cp .env.example .env
infra/scripts/gen-secret.sh --write        # generates PROXY_SECRET (required)
```

If you plan to use the Android TV app, copy its `assetlinks.json` into `infra/caddy/` now and again after
every fresh clone. The file is git-ignored on purpose (it holds your app's signing fingerprint), so a clone never
contains it. Caddy serves it from that directory. Without the file, the TV app's domain verification fails. See
[apps/tv/README.md](../apps/tv/README.md).

Edit `.env` and set at least:

```
DOMAIN=tv.example.com
PUBLIC_URL=https://tv.example.com
```

Everything else has a sensible default. The two decisions worth making now:

- `COMPOSE_PROFILES=proxy,epg` — keep both for the full experience. Drop `proxy` if you do not want
  your server relaying video for visitors (fewer channels will play). Drop `epg` if you do not want a
  TV guide (saves CPU; the grabber is the heaviest thing here).
- `EPG_SITES=all` — the default grabs a guide for every channel that has one (about 11,700 channels
  from ~190 sites, several hours per run). It needs the 4 GB the `epg` container may use. On a VM with less
  memory, start with a short list, e.g. `EPG_SITES=tvguide.com,freeview.co.uk`, and add `EPG_SPLIT_BY_SITE=true`
  so one slow site cannot stall the whole run.

## 4. Start it

```sh
docker compose up -d --build
# The first ingest downloads ~60 MB. Step 5 shows when it has finished (channels > 0 in /api/meta).
```

Build takes a few minutes the first time (it compiles the UI and installs the EPG grabber). The core services
start first, and `epg` builds last. If the grabber fails to build, the site still comes up; retry it with
`docker compose up -d --build epg` and read `docker compose logs epg` if it fails again.

If you would rather pull prebuilt images, set `GITHUB_REPOSITORY_OWNER=<you>` in `.env` once your
fork's GitHub Actions has pushed images to GHCR, then `docker compose pull && docker compose up -d`.
While `GITHUB_REPOSITORY_OWNER` is empty, nothing is pulled and every image is built here.

## 5. Check it

```sh
curl -s https://tv.example.com/api/health          # {"ok":true}
curl -s https://tv.example.com/api/meta | jq       # channel counts, last ingest, proxy enabled
```

Open `https://tv.example.com` in a browser, pick a channel, press play. Open `/tv` on a TV browser.
Add `https://tv.example.com/api/playlist.m3u` to TiviMate/Kodi if you prefer those.

The guide fills in after the first grab finishes: `docker compose logs -f epg`. The api notices the
new file within a minute and `/api/meta` shows `programmes` > 0.

## 6. Keep it running

```sh
infra/scripts/update.sh           # git pull, rebuild/pull images, restart, prune
```

Backups (`infra/scripts/backup.sh`), resource limits and everything else routine: [OPERATIONS.md](OPERATIONS.md).
When something is wrong: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

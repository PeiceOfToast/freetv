# Deploying FreeTV on Hetzner Cloud (untested)

**Status: untested.** `cloud-init.yaml` follows the Oracle bootstrap but was not run on a Hetzner server.

Works on any Hetzner Cloud server type with Ubuntu 24.04. `cax*` (Arm) and `cx*`/`cpx*` (x86) are both fine,
because every image is multi-arch. The generic steps (`.env`, updates, backups) are in
[docs/DEPLOY.md](../../../docs/DEPLOY.md).

## Differences from Oracle

- **Firewall.** Hetzner's Ubuntu image has no REJECT rule in iptables, so there is no iptables editing.
  The bootstrap enables `ufw` with OpenSSH, 80/tcp, 443/tcp and 443/udp.
- **Cloud firewall.** Hetzner has its own cloud firewall. It is optional, because ufw already does the job.
  If you use it, allow the same ports there.
- **Docker and ufw.** Docker publishes ports through its own iptables rules, which bypass ufw. Only `web`
  publishes ports, so this is the intended exposure. `api`, `proxy` and `epg` are reachable only inside the
  compose network.

## 1. Edit the cloud-init file

Replace `__REPO_URL__` and `__DOMAIN__` in `cloud-init.yaml`, the same as the Oracle guide. An unreplaced
`__DOMAIN__` means plain HTTP on the server IP.

## 2. Create the server

With the [hcloud CLI](https://github.com/hetznercloud/cli) and an SSH key already uploaded to your project
(`hcloud ssh-key list`):

```sh
hcloud server create --name freetv --type cax21 --image ubuntu-24.04 --location fsn1 \
  --ssh-key <your-key-name> --user-data-from-file infra/deploy/hetzner/cloud-init.yaml
```

`cax21` is 4 Arm vCPU / 8 GB. Use `cx22` for an x86 box with 2 vCPU / 4 GB. Drop `--location` to take the default.
To keep the placeholders in your checkout, pass a copy of `cloud-init.yaml` with them replaced.

## 3. DNS and first boot

- Create an A record for your hostname pointing at `hcloud server ip freetv`. Let's Encrypt needs port 80 to
  reach the server, so DNS must be in place before the first HTTPS request. Caddy retries automatically.
- Watch the bootstrap: `ssh root@<ip> tail -f /var/log/freetv-bootstrap.log`. The first image build takes a while.
  It ends with `== done`.

## 4. Verify

```sh
ssh root@<ip> 'sudo -u freetv -H bash -c "cd /opt/freetv && docker compose ps"'
ssh root@<ip> 'ufw status verbose'          # 22, 80, 443 and 443/udp allowed
curl -sS https://<hostname>/api/health       # or http://<ip>/api/health when DOMAIN is empty
```

## Pulling published images instead of building

The bootstrap builds on the server. To pull images from GHCR instead, replace the last compose step with
`docker compose pull && docker compose up -d` (and set `GITHUB_REPOSITORY_OWNER` in `.env`). Building on the
server is slower but needs no published images.

## Automatic updates

`infra/auto-update/install.sh` works here too. See docs/DEPLOY.md, "Automatic updates".

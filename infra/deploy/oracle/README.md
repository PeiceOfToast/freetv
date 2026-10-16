# Deploy FreeTV on Oracle Cloud Always Free

Target: one `VM.Standard.A1.Flex` instance (4 OCPU, 12 GB, Arm) running Ubuntu 24.04. This is
the whole Always-Free Arm allowance used as a single VM (Oracle also offers two tiny AMD VMs with
1/8 OCPU and 1 GB each; they can run the site with the guide and relay switched off, but not the full
stack). This is
enough for the full stack (web, api, proxy, epg). Everything runs on the box; no managed services.

The generic steps (Docker, `.env`, updates, backups) are in [docs/DEPLOY.md](../../../docs/DEPLOY.md).
This folder covers the parts specific to Oracle: console clicks, the security list, and the
host firewall that Oracle's images ship with.

## 0. Before you start

- A domain you control, for example `tv.example.com`. You will add one DNS record. Without a domain
  the site runs on plain HTTP at the instance IP (fine for testing, not for real use).
- A git URL for the repo the instance should clone (your fork, or the upstream repo).
- Decide whether to keep the default profiles (`proxy` and `epg`) or drop one. See the `.env` notes in docs/DEPLOY.md.

## 1. Edit the cloud-init file

Open [cloud-init.yaml](cloud-init.yaml) and replace the two placeholders near the top:

| Placeholder | Replace with | Example |
|-------------|--------------|---------|
| `__REPO_URL__` | git URL to clone | `https://github.com/you/freetv.git` |
| `__DOMAIN__` | public hostname, or empty for plain HTTP | `tv.example.com` |

The bootstrap refuses to run if `__REPO_URL__` is still a placeholder. An unreplaced `__DOMAIN__`
is treated as empty (plain HTTP).

## 2. Create the instance

In the OCI console: **Compute → Instances → Create instance**.

1. **Name:** `freetv`.
2. **Image:** click *Change image* → *Canonical Ubuntu* → **24.04** → make sure the architecture is
   **aarch64** (Arm). Images for the x86 shape will not work with the A1 shape.
3. **Shape:** *Change shape* → **Ampere** → **VM.Standard.A1.Flex** → **4 OCPU, 12 GB memory (the whole Always-Free Arm allowance in one VM)**
   (the Always Free maximum; you can use less).
4. **Networking:** use an existing VCN, or let the wizard create one. Make sure the subnet is
   **public** and **Assign a public IPv4 address** is on.
5. **SSH keys:** upload or paste your public key (needed to log in and debug).
6. **Boot volume:** expand *Boot volume* and set **100 GB** (Always Free includes 200 GB of block storage;
   the default 47 GB works but Docker images, the logo cache and a large guide add up).

> **"Out of host capacity"** is the usual error when creating a free A1 instance — the Arm pool in your home
> region is often full. It is not a quota problem. Try another *availability domain* in the shape dialog,
> retry at a different time of day (early morning in the region's time zone tends to work), or temporarily
> try 2 OCPU / 6 GB and resize later. Upgrading the account to Pay-As-You-Go (no charge while you stay within
> Always Free limits) also lifts you out of the most contended pool. Do not pick the AMD micro shape as a
> workaround: 1 GB of RAM is not enough for the guide grabber (see below).
6. Expand **Show advanced options → Initialization script**, choose **Paste cloud-init script**
   (or *Cloud-init script*), and paste the full edited contents of `cloud-init.yaml`.
7. Click **Create**. Wait for the state to show *Running*, then note the **Public IP address**.

## 3. Open ports 80 and 443 in the VCN security list

Oracle blocks everything except SSH at the network edge. The host firewall is handled by the
bootstrap script, but the VCN rules are separate and must be added by you.

1. **Networking → Virtual Cloud Networks** → your VCN → **Security Lists** → the subnet's security
   list (usually *Default Security List for …*).
2. **Add Ingress Rules**, one rule each:
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range **80**.
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range **443**.
   - Optional, for HTTP/3: Source CIDR `0.0.0.0/0`, IP protocol **UDP**, destination port **443**.
3. Save. The rules apply immediately.

## 4. Point DNS at the instance

At your DNS provider, create an **A record**:

- Name: `tv` (or `@` for the apex domain)
- Value: the instance's public IP
- TTL: 300 (or the provider default)

Caddy requests the certificate on the first HTTPS connection and retries automatically while DNS
propagates, so you do not need to wait before starting the stack. Let's Encrypt must be able to
reach port 80 on the instance for the HTTP challenge.

## 5. Verify

From your machine:

```sh
ssh ubuntu@<public-ip>                      # the default user on Ubuntu cloud images
sudo tail -f /var/log/freetv-bootstrap.log  # wait for "== done" (first build takes several minutes)
```

On the instance:

```sh
sudo -u freetv -H bash -c 'cd /opt/freetv && docker compose ps'
sudo iptables -S INPUT | grep -E 'dport (80|443) '   # the two ACCEPT rules must exist
curl -sS http://localhost/api/health                  # JSON status from the api, through Caddy
```

From a browser: `https://tv.example.com` (or `http://<public-ip>` when `DOMAIN` is empty). The
browse page should load. Once the catalog has been ingested (a few minutes after first start) it
will list channels. Play a channel to confirm streams work.

## Troubleshooting

- **Site unreachable from outside, but `curl localhost` works:** the VCN security list rule is
  missing, or the iptables ACCEPT rules are not in place (`sudo iptables -S INPUT`). Re-check step 3.
- **Certificate error / no HTTPS:** DNS does not point at this IP yet, or port 80 is closed.
  `docker compose logs web` shows the ACME attempts.
- **Bootstrap failed:** read `/var/log/freetv-bootstrap.log`. It is safe to fix the cause and
  run `sudo /usr/local/sbin/freetv-bootstrap.sh` again: it skips the clone and `.env` creation if
  they exist.
- **Instance reclaimed or stopped:** Oracle may reclaim idle Always Free compute. Keep the
  instance busy (a live public site usually is) and check the console if it stops responding.

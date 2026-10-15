# Security policy

## Reporting

Please report vulnerabilities privately rather than in a public issue. Use GitHub's "Report a
vulnerability" (Security tab → Advisories) on this repository, or email the maintainer listed in the
repository profile. Include the affected version/commit, steps to reproduce and impact. You will get
an acknowledgement within a few days.

## Scope

The relay (`apps/proxy`) is the most security-relevant piece: it fetches URLs on behalf of visitors.
Reports about signature bypass, SSRF (reaching private addresses, cloud metadata endpoints), header
injection, resource exhaustion or cache poisoning through it are especially welcome. Also in scope:
the api's admin endpoints, the Caddy configuration, the PWA service worker, and the TV spatial
navigation if it can be abused by page content.

Out of scope: the content of third-party streams, guide sites, and iptv-org's data; and
vulnerabilities in dependencies that are not exploitable through FreeTV.

## Hardening checklist for operators

- Set a real `PROXY_SECRET` (`infra/scripts/gen-secret.sh --write`); the api and proxy refuse the placeholder.
- Keep `ADMIN_TOKEN` empty unless you use the admin endpoints; if set, make it long and random.
- Leave `PROXY_ALLOW_PRIVATE` unset (false) on any internet-facing instance.
- Only publish ports 80 and 443. The compose file already does this.
- Run `infra/scripts/update.sh` regularly; images are rebuilt from upstream base images in CI.
- Rotate Docker logs (see `docs/OPERATIONS.md`) so the relay's access log can't fill the disk.

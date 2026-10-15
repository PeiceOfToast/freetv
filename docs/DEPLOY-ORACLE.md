# Deploying FreeTV on Oracle Cloud (Always Free)

The reference deployment is one `VM.Standard.A1.Flex` instance (4 OCPU, 24 GB, Ubuntu 24.04 Arm).
It fits the whole stack with headroom, at no cost on the Always Free tier.

Everything is in [`infra/deploy/oracle/`](../infra/deploy/oracle/):

- [`README.md`](../infra/deploy/oracle/README.md): step-by-step console walkthrough. Instance shape and image,
  VCN security list rules for 80/443, DNS A record, verification, and troubleshooting.
- [`cloud-init.yaml`](../infra/deploy/oracle/cloud-init.yaml): the first-boot script. It opens the host
  firewall for 80/443, installs Docker, creates the `freetv` user, clones the repo to `/opt/freetv`,
  writes `.env` with a generated `PROXY_SECRET`, and starts the stack.

You fill in two values before pasting the file into the console: the repo URL and your domain.

Oracle's Ubuntu images ship a restrictive iptables ruleset that blocks 80 and 443 even when the
security list allows them. The bootstrap handles that. Opening the VCN security list is still
your job, as described in the walkthrough.

For anything beyond first setup (updates, backups, narrowing the guide, disabling the relay,
troubleshooting), the generic guide applies unchanged: [DEPLOY.md](DEPLOY.md).

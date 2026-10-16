# FreeTV documentation

Start here. The documents are ordered the way a new operator or contributor should read them.

## I want to run it

| Doc | What it answers |
|-----|-----------------|
| [GETTING-STARTED.md](GETTING-STARTED.md) | From an empty VM to a working site with HTTPS in about ten minutes. |
| [DEPLOY.md](DEPLOY.md) | Hosting on any Linux box with Docker: configuration, updating, backups, disabling parts. |
| [DEPLOY-ORACLE.md](DEPLOY-ORACLE.md) | The Oracle Cloud Always-Free walkthrough (console steps + cloud-init). |
| [OPERATIONS.md](OPERATIONS.md) | Day-two runbook: health checks, logs, what each container does, routine tasks, capacity. |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Symptom → cause → fix, for everything we have seen or anticipate. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The services, the data flow, and the full environment-variable reference. |
| [LEGAL.md](LEGAL.md) | What FreeTV does and does not do with other people's streams, and how takedowns work. |

## I want to use it on a phone or TV

| Doc | What it answers |
|-----|-----------------|
| [MOBILE.md](MOBILE.md) | Installing the app on iPhone/Android, offline behaviour, lock-screen controls, casting. |
| [TV.md](TV.md) | Chromecast/AirPlay, TV browsers (`/tv`), Android TV / Fire TV / Tizen / webOS packaging, and using FreeTV as an M3U + XMLTV source for TiviMate, Kodi, Plex, Jellyfin and VLC. |

## I want to change it

Note: [REVIEW-2026-10-16.md](REVIEW-2026-10-16.md), [PARALLEL-WORK.md](PARALLEL-WORK.md), [PLAN.md](PLAN.md) and
everything under [notes/](notes/) are internal development notes: working records of how the project was built
and reviewed. They are kept for history, may be out of date, and are not user or operator documentation.

| Doc | What it answers |
|-----|-----------------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Repo layout, running each service locally, tests, fixtures, coding conventions, release. |
| [API.md](API.md) | The HTTP contract of the `api` service and the proxy's URL signing. |
| [DATA.md](DATA.md) | The iptv-org datasets we ingest, their shapes, and how we derive our catalog. |
| [DECISIONS.md](DECISIONS.md) | Why things are the way they are: the design decisions and their trade-offs. |
| [ROADMAP.md](ROADMAP.md) | What we would build next, roughly in order of value. |
| [REVIEW-2026-10-16.md](REVIEW-2026-10-16.md) | Independent pre-launch review: prioritised checks and fixes with status. |
| [PLAN.md](PLAN.md) | The original project plan and the status of each milestone. |
| [PARALLEL-WORK.md](PARALLEL-WORK.md) | How the codebase is split so several people/agents can work at once. |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) · [../SECURITY.md](../SECURITY.md) · [../CHANGELOG.md](../CHANGELOG.md) | Contribution rules, reporting vulnerabilities, release history. |
| [notes/](notes/) | Raw engineering notes from each build track (verification logs, deviations, open questions). |

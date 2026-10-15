# Working in parallel

The repo is split so that several people/agents can build at once without merge conflicts.
Rules:

1. **Own your directory.** Each track edits only the paths listed below. If you need something
   outside, write it in your track's `NOTES.md` and the integrator will do it.
2. **The contracts are frozen** during a sprint: `docs/API.md`, `apps/api/src/db/schema.sql`,
   `docs/ARCHITECTURE.md` (env vars). Propose changes in `NOTES.md`; don't edit them.
3. **Everything must build offline** from this sandbox: network access to iptv-org is not
   guaranteed at dev time. Sample data lives in `apps/api/test/fixtures/` (small slices of the real JSON).
4. **No shared packages.** Copy the 10-line signing helper; don't create a workspace package.

| Track | Owns | Must not touch |
|-------|------|----------------|
| A api/ingest | `apps/api/src/ingest/**`, `apps/api/test/ingest*`, `apps/api/test/fixtures/**` | routes, epg |
| B api/routes | `apps/api/src/routes/catalog.ts`, `apps/api/src/routes/stream.ts`, `apps/api/src/lib/**`, `apps/api/test/routes*` | ingest, epg |
| C api/epg | `apps/api/src/epg/**`, `apps/api/src/routes/epg.ts`, `apps/api/test/epg*` | ingest, catalog routes |
| D web/browse | `apps/web/src/pages/browse/**`, `apps/web/src/components/browse/**` | watch, guide, player, lib/api.ts |
| E web/watch | `apps/web/src/pages/watch/**`, `apps/web/src/pages/guide/**`, `apps/web/src/components/player/**`, `apps/web/src/components/guide/**` | browse, lib/api.ts |
| F proxy | `apps/proxy/**` | everything else |
| G epg container | `apps/epg/**` | everything else |
| H infra | `infra/**`, `apps/web/Dockerfile`, `.github/**`, `README.md` deploy section, `docs/DEPLOY*.md` | app source |

Shared files written by the integrator before tracks start: `apps/api/src/server.ts`, `config.ts`,
`db/index.ts`, `apps/web/src/lib/api.ts` (client + TS types mirroring `docs/API.md`), `App.tsx`, layout.

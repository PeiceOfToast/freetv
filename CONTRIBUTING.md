# Contributing

Thanks for helping. FreeTV is small and opinionated; the fastest way to get a change in is to keep
it in that spirit.

## Before you start

- Read `docs/DEVELOPMENT.md` (layout, running locally, tests) and `docs/DECISIONS.md` (why things are
  the way they are). If your change reverses a decision, say so in the PR and make the case.
- For anything bigger than a bug fix, open an issue first describing the problem and the proposed
  approach. `docs/ROADMAP.md` lists what we already want.
- Streams and channels are not managed here. To add, fix or remove a channel, contribute to
  https://github.com/iptv-org/database — it flows into every FreeTV instance automatically.

## Pull requests

- One topic per PR. Keep the diff reviewable.
- `npm run typecheck && npm test` in `apps/api` and `apps/proxy`, `npm run build` in `apps/web`.
  CI runs the same.
- If you change an API shape, update `docs/API.md` and `apps/web/src/lib/api.ts` in the same PR.
- If you change the schema, bump `SCHEMA_VERSION`.
- If you add an env var, add it to the table in `docs/ARCHITECTURE.md`, `.env.example` and compose.
- If you change the Caddyfile, change both copies (`infra/caddy/` and `apps/web/`).
- Screenshots for UI changes, please — phone width and desktop; 1920×1080 for `/tv`.
- No new runtime dependencies without a sentence on why. The proxy stays dependency-light.

## Working in parallel

The repo is split into tracks that own directories so several people (or agents) can work at once
without conflicts. `docs/PARALLEL-WORK.md` has the map. If you are using AI agents, give each one a
track and the contract docs; integrate in a separate pass.

## Code of conduct

Be kind, assume good faith, keep discussions about the code. Maintainers may close issues or PRs
that do not follow this.

## License

By contributing you agree your contribution is licensed under the MIT License in `LICENSE`.

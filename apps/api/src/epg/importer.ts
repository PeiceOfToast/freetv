import type { FastifyBaseLogger } from "fastify";
// TRACK C: stream-parse XMLTV at config.epgFile into `programmes`; poll mtime every config.epgPollSeconds.
export async function importEpg(opts: { force?: boolean } = {}, log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">): Promise<void> {
  void opts; log?.warn("epg import not implemented");
}
export function startEpgWatcher(log: Pick<FastifyBaseLogger, "info" | "warn" | "error">): void {
  void importEpg({}, log).catch((e) => log.error(e));
}

import type { FastifyBaseLogger } from "fastify";
// TRACK A: download iptv-org datasets, rebuild catalog tables in one transaction, schedule.
export async function runIngest(log?: Pick<FastifyBaseLogger, "info" | "warn" | "error">): Promise<void> {
  log?.warn("ingest not implemented");
}
export function scheduleIngest(log: Pick<FastifyBaseLogger, "info" | "warn" | "error">): void {
  void runIngest(log).catch((e) => log.error(e));
}

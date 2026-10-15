import type { FastifyBaseLogger } from "fastify";
// TRACK P: background stream health prober. See docs/API.md "Stream health" and schema.sql stream_health.
export type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;
export async function runProbe(log?: Log, opts: { channels?: string[]; limit?: number } = {}): Promise<{ checked: number; online: number; offline: number }> {
  void opts; log?.warn("prober not implemented");
  return { checked: 0, online: 0, offline: 0 };
}
export function startProber(log: Log): void { void log; }

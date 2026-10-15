// TRACK P: background stream health prober. See docs/API.md "Stream health" and schema.sql stream_health.
import { config } from "../config.js";
import { runProbe, type ProbeLog } from "./scheduler.js";

export type Log = ProbeLog;
export { runProbe, isProbeRunning } from "./scheduler.js";
export type { ProbeCounts, ProbeOpts } from "./scheduler.js";
export { probeStream } from "./probe.js";
export type { ProbeOptions, ProbeResult } from "./probe.js";

/** Ingest runs at boot; the first probe pass waits for it to finish. */
export const BOOT_DELAY_MS = 2 * 60_000;

/** When PROBE_ENABLED: one pass 2 minutes after boot, then one every PROBE_INTERVAL_HOURS. Timers are unref'd. */
export function startProber(log: Log): void {
  if (!config.probeEnabled) {
    log.info("prober: disabled (PROBE_ENABLED is false)");
    return;
  }
  const tick = () => {
    runProbe(log).catch((e) => log.error(e));
  };
  const boot = setTimeout(() => {
    tick();
    const hours = config.probeIntervalHours;
    if (hours > 0) setInterval(tick, hours * 3_600_000).unref();
  }, BOOT_DELAY_MS);
  boot.unref();
}

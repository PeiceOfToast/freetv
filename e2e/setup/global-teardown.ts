// Stops every service started by global-setup and removes the temp DATA_DIR.
// Server logs stay in e2e/test-results/server-logs so CI can upload them.
import fs from "node:fs";
import { STATE_ENV } from "./paths.ts";

export default async function globalTeardown() {
  const raw = process.env[STATE_ENV];
  if (!raw) return;
  const state = JSON.parse(raw) as { runDir: string; pids: number[] };
  for (const pid of state.pids) {
    try { process.kill(-pid, "SIGTERM"); } catch { /* already exited */ }
  }
  // Give the processes a moment to release their files before deleting DATA_DIR.
  await new Promise((r) => setTimeout(r, 500));
  for (const pid of state.pids) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* exited */ }
  }
  fs.rmSync(state.runDir, { recursive: true, force: true });
  delete process.env[STATE_ENV];
}

import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";

/** "::ffff:1.2.3.4" (and the hex form "::ffff:102:304") -> "1.2.3.4". Other addresses are lower-cased. */
export function normaliseIp(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice("::ffff:".length);
    if (isIP(rest) === 4) return rest;
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    }
  }
  return lower;
}

export interface ClientIpInput {
  forwardedFor: string | string[] | undefined;
  socketAddress: string | undefined;
  trustProxy: boolean;
}

/**
 * Client address used as the rate-limit key. With trustProxy, the LAST X-Forwarded-For entry is used:
 * Caddy (the only hop in front of us) appends the real peer address to whatever the client sent, so
 * the last entry is the one we can trust and a client cannot pick its own bucket. Falls back to the
 * socket address when the header is missing or malformed. See docs/notes/proxy.md.
 */
export function clientIp({ forwardedFor, socketAddress, trustProxy }: ClientIpInput): string {
  const socket = normaliseIp(socketAddress ?? "unknown");
  if (!trustProxy) return socket;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  const parts = header?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const last = parts[parts.length - 1];
  if (!last) return socket;
  const ip = normaliseIp(last);
  return isIP(ip) ? ip : socket;
}

/**
 * Logs never carry raw addresses. The salt is random per process, so hashes cannot be joined across
 * restarts or matched against a precomputed table of IPv4 addresses.
 */
export function makeIpHasher(): (ip: string) => string {
  const salt = randomBytes(16);
  return (ip) => createHash("sha256").update(salt).update(ip).digest("hex").slice(0, 12);
}

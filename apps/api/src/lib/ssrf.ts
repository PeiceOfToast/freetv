// Outbound SSRF guard for the api's upstream fetches (stream prober, logo cache).
// Ported from apps/proxy/src/ssrf.ts. Keep the two copies in sync: the address rules are the same.
//
// Two layers:
//  1. assertPublicTarget(url) before every hop: scheme, literal IPs, hostnames, and the resolved addresses.
//  2. guardedLookup as the undici connector's DNS lookup: re-checks the address that is actually
//     connected to, which closes the window between (1) and the connect (DNS rebinding).
// Literal IP hosts never reach the connector lookup, so (1) is the only check for them.
// Redirects are not followed by undici: guardedFetch returns the 3xx and the caller re-checks the next hop.
//
// FETCH_ALLOW_PRIVATE=true (config.fetchAllowPrivate) disables both layers (tests, LAN installs).

import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { Agent, fetch, type Dispatcher, type Response } from "undici";
import { config } from "../config.js";

export class TargetForbiddenError extends Error {
  readonly code = "EFORBIDDEN_TARGET";
  constructor(message: string) {
    super(message);
  }
}

// Address ranges that must never be fetched from the public proxy.
// Two lists: node's BlockList matches IPv4 addresses against IPv4-mapped IPv6 rules, so mixing
// "::ffff:0:0/96" into one list would block every IPv4 address. Mapped addresses are unwrapped first.
const blockedV4 = new BlockList();
blockedV4.addSubnet("0.0.0.0", 8, "ipv4");        // "this" network
blockedV4.addSubnet("10.0.0.0", 8, "ipv4");       // private
blockedV4.addSubnet("100.64.0.0", 10, "ipv4");    // carrier-grade NAT
blockedV4.addSubnet("127.0.0.0", 8, "ipv4");      // loopback
blockedV4.addSubnet("169.254.0.0", 16, "ipv4");   // link-local (cloud metadata lives here)
blockedV4.addSubnet("172.16.0.0", 12, "ipv4");    // private
blockedV4.addSubnet("192.168.0.0", 16, "ipv4");   // private
blockedV4.addSubnet("224.0.0.0", 4, "ipv4");      // multicast

const blockedV6 = new BlockList();
blockedV6.addAddress("::", "ipv6");               // unspecified
blockedV6.addAddress("::1", "ipv6");              // loopback
blockedV6.addSubnet("fc00::", 7, "ipv6");         // unique local
blockedV6.addSubnet("fe80::", 10, "ipv6");        // link-local
blockedV6.addSubnet("::ffff:0:0", 96, "ipv6");    // IPv4-mapped forms we could not unwrap: refuse
blockedV6.addSubnet("64:ff9b::", 96, "ipv6");     // NAT64 can reach private IPv4

/** "::ffff:a.b.c.d" or "::ffff:xxxx:yyyy" -> dotted IPv4, or null when not an IPv4-mapped address. */
function mappedIPv4(ip: string): string | null {
  const m = /^::ffff:(.+)$/i.exec(ip);
  if (!m) return null;
  const rest = m[1];
  if (rest.includes(".")) return rest;
  const parts = rest.split(":");
  if (parts.length !== 2 || !parts.every((p) => /^[0-9a-f]{1,4}$/i.test(p))) return null;
  const n = (parseInt(parts[0], 16) << 16) | parseInt(parts[1], 16);
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

/** True when a literal IP address (v4 or v6, brackets already stripped) is not publicly routable. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blockedV4.check(ip, "ipv4");
  if (family === 6) {
    const v4 = mappedIPv4(ip.toLowerCase());
    if (v4) return blockedV4.check(v4, "ipv4");
    return blockedV6.check(ip, "ipv6");
  }
  return true; // not an IP at all: treat as blocked
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h === "metadata.google.internal") return true;
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

function stripBrackets(h: string) {
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

/**
 * Validates an upstream URL before fetching it. Throws TargetForbiddenError on violation.
 * Hostnames are resolved and every resolved address is checked. A DNS failure throws its own error.
 */
export async function assertPublicTarget(url: URL, allowPrivate: boolean = config.fetchAllowPrivate): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TargetForbiddenError("scheme not allowed");
  }
  if (allowPrivate) return;
  const host = stripBrackets(url.hostname);
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new TargetForbiddenError("address not allowed");
    return;
  }
  if (isBlockedHostname(host)) throw new TargetForbiddenError("hostname not allowed");
  const addrs = await resolveAll(host);
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a))) {
    throw new TargetForbiddenError("resolved address not allowed");
  }
}

function resolveAll(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return reject(err);
      resolve(addrs.map((a) => a.address));
    });
  });
}

/**
 * DNS lookup for undici's connector: re-checks the address actually used for the connection,
 * which closes the gap between the pre-check above and the real connect (DNS rebinding).
 */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  callback: (err: Error | null, address?: unknown, family?: number) => void,
) {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
    if (err) return callback(err);
    if (addrs.some((a) => isBlockedAddress(a.address))) {
      return callback(new TargetForbiddenError("resolved address not allowed"));
    }
    if (options.all) return callback(null, addrs);
    const first = addrs[0];
    if (!first) return callback(new Error("no address"));
    callback(null, first.address, first.family);
  });
}

let agent: Agent | null = null;

/** Shared undici dispatcher whose connector uses guardedLookup. Built once per process. */
export function guardedAgent(): Agent {
  if (!agent) {
    // undici's connect.lookup type is narrower than Node's; guardedLookup has the same shape at runtime.
    agent = new Agent({ connect: { lookup: guardedLookup as never } });
  }
  return agent;
}

/**
 * One hop of an upstream GET. Redirects are never followed here (redirect: manual); callers loop and
 * re-check each Location through assertPublicTarget. With the guard on, the connection goes through
 * guardedAgent(). With FETCH_ALLOW_PRIVATE=true it is a plain undici fetch.
 */
export async function guardedFetch(
  target: URL,
  init: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<Response> {
  await assertPublicTarget(target);
  const dispatcher: Dispatcher | undefined = config.fetchAllowPrivate ? undefined : guardedAgent();
  return fetch(target, { method: "GET", redirect: "manual", ...init, dispatcher });
}

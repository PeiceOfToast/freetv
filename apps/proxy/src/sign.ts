import { createHmac, timingSafeEqual } from "node:crypto";
// Copied from apps/api/src/lib/sign.ts (no shared packages). Keep in sync with docs/API.md.
export function b64url(buf: Buffer | string) { return Buffer.from(buf).toString("base64url"); }
export function signPayload(secret: string, payload: string) { return createHmac("sha256", secret).update(payload).digest("base64url"); }
export function makeProxyUrl(secret: string, publicPath: string, u: string, ua: string | null | undefined, r: string | null | undefined, exp: number) {
  const payload = b64url(JSON.stringify({ u, ...(ua ? { ua } : {}), ...(r ? { r } : {}), exp }));
  return `${publicPath}/${signPayload(secret, payload)}/${payload}`;
}
// Constant-time check of a signature produced by signPayload.
export function verifySignature(secret: string, payload: string, sig: string): boolean {
  const expected = Buffer.from(signPayload(secret, payload));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Segments may be fetched this long after exp, so a viewer's current playlist keeps playing briefly. */
export const SEGMENT_GRACE_SECONDS = 600;
/** exp more than this far ahead of now is refused (guards against signed far-future expiries). */
export const MAX_EXP_AHEAD_SECONDS = 30 * 86400;

export type ExpiryVerdict = "ok" | "missing" | "expired" | "invalid";

/**
 * Judges a payload's exp (unix seconds) for a request of the given kind. Playlists must be within exp;
 * segments (non-playlist resources) also get SEGMENT_GRACE_SECONDS after it. A missing exp is never ok.
 */
export function checkExpiry(exp: number | undefined, nowSec: number, kind: "playlist" | "segment"): ExpiryVerdict {
  if (exp === undefined) return "missing";
  if (exp > nowSec + MAX_EXP_AHEAD_SECONDS) return "invalid";
  const deadline = kind === "segment" ? exp + SEGMENT_GRACE_SECONDS : exp;
  return nowSec > deadline ? "expired" : "ok";
}

import { createHmac, timingSafeEqual } from "node:crypto";
// Copied from apps/api/src/lib/sign.ts (no shared packages). Keep in sync with docs/API.md.
export function b64url(buf: Buffer | string) { return Buffer.from(buf).toString("base64url"); }
export function signPayload(secret: string, payload: string) { return createHmac("sha256", secret).update(payload).digest("base64url"); }
export function makeProxyUrl(secret: string, publicPath: string, u: string, ua?: string | null, r?: string | null) {
  const payload = b64url(JSON.stringify({ u, ...(ua ? { ua } : {}), ...(r ? { r } : {}) }));
  return `${publicPath}/${signPayload(secret, payload)}/${payload}`;
}
// Constant-time check of a signature produced by signPayload.
export function verifySignature(secret: string, payload: string, sig: string): boolean {
  const expected = Buffer.from(signPayload(secret, payload));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

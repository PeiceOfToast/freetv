import { createHmac } from "node:crypto";
// Shared with apps/proxy (copied, not imported). See docs/API.md.
export function b64url(buf: Buffer | string) { return Buffer.from(buf).toString("base64url"); }
export function signPayload(secret: string, payload: string) { return createHmac("sha256", secret).update(payload).digest("base64url"); }
export function makeProxyUrl(secret: string, publicPath: string, u: string, ua?: string | null, r?: string | null) {
  const payload = b64url(JSON.stringify({ u, ...(ua ? { ua } : {}), ...(r ? { r } : {}) }));
  return `${publicPath}/${signPayload(secret, payload)}/${payload}`;
}

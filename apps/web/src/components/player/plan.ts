/** Most attempts a single channel may use automatically, direct ones first. Extra sources stay manual. */
export const MAX_ATTEMPTS = 8;
/** A direct URL that does not start within this time is almost always dead or blocked. */
export const DIRECT_TIMEOUT_MS = 5000;
/** Relay URLs go through our own proxy and may need longer to start. */
export const RELAY_TIMEOUT_MS = 8000;

/**
 * True when the page is served over https and the URL is plain http. Browsers block that as mixed
 * content, so a direct attempt can never work and is skipped.
 */
export function isMixedContent(url: string): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:" && /^http:/i.test(url);
}

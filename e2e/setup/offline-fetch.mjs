// Preloaded (node --import) into the API process during e2e runs.
// Refuses every outbound fetch so the startup ingest cannot download iptv-org data (the primary
// host and the raw.githubusercontent.com mirror are hard-coded in apps/api/src/config.ts) and
// replace the fixture catalog. Loopback requests (the fake HLS origin, the proxy) still work.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(href).hostname;
  if (!LOOPBACK.has(host)) {
    return Promise.reject(new TypeError(`e2e: outbound fetch blocked (${host})`));
  }
  return realFetch(input, init);
};

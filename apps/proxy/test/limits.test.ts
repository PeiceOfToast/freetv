import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startProxy, startUpstream, closeServer, signed, SEG, REFERER, UA } from "./helpers.js";
import type { ProxyServer } from "../src/server.js";
import type { Server } from "node:http";

let upstream: Server;
let up = "";

before(async () => {
  const u = startUpstream();
  upstream = u.server;
  up = `http://127.0.0.1:${await u.ready}`;
});
after(async () => { await closeServer(upstream); });

/** The access log and the metrics are written as the response finishes; give that a moment before reading. */
const settle = () => new Promise((r) => setTimeout(r, 30));

/** Parses Prometheus text into a map of "name{labels}" -> value (labels kept verbatim). */
function parseMetrics(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.lastIndexOf(" ");
    out.set(line.slice(0, idx), Number(line.slice(idx + 1)));
  }
  return out;
}

describe("per-IP rate limiting", () => {
  let limited: ProxyServer;
  let origin = "";
  before(async () => {
    // Effectively no refill (one token per 1000 s) so the test is independent of timing.
    ({ proxy: limited, origin } = await startProxy({ rateLimitRps: 0.001, rateLimitBurst: 2 }));
  });
  after(async () => { await limited.close(); });

  it("returns 429 with Retry-After, a JSON body and CORS headers once the bucket is empty", async () => {
    const path = signed(`${up}/seg.bin`);
    assert.equal((await fetch(`${origin}${path}`)).status, 200);
    assert.equal((await fetch(`${origin}${path}`)).status, 200);
    const res = await fetch(`${origin}${path}`);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    const retry = Number(res.headers.get("retry-after"));
    assert.ok(Number.isInteger(retry) && retry >= 1, `retry-after was ${res.headers.get("retry-after")}`);
    assert.deepEqual(await res.json(), { error: "rate limited" });
  });

  it("does not limit healthz, metrics or OPTIONS", async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await fetch(`${origin}/healthz`)).status, 200);
      assert.equal((await fetch(`${origin}/metrics`)).status, 200);
      assert.equal((await fetch(`${origin}${signed(`${up}/seg.bin`)}`, { method: "OPTIONS" })).status, 204);
    }
  });

  it("counts playlist and segment requests against the same bucket", async () => {
    const { proxy, origin: o } = await startProxy({ rateLimitRps: 0.001, rateLimitBurst: 1 });
    try {
      const playlist = await fetch(`${o}${signed(`${up}/real/media/index.m3u8`, UA, REFERER)}`);
      assert.equal(playlist.status, 200);
      await playlist.arrayBuffer();
      const seg = await fetch(`${o}${signed(`${up}/seg.bin`)}`);
      assert.equal(seg.status, 429);
      await seg.arrayBuffer();
    } finally {
      await proxy.close();
    }
  });

  it("is keyed by X-Forwarded-For when trusted, and by the socket when not", async () => {
    const trusted = await startProxy({ rateLimitRps: 0.001, rateLimitBurst: 1, trustProxy: true });
    const untrusted = await startProxy({ rateLimitRps: 0.001, rateLimitBurst: 1, trustProxy: false });
    try {
      const path = signed(`${up}/seg.bin`);
      const get = (o: string, xff?: string) => fetch(`${o}${path}`, { headers: xff ? { "x-forwarded-for": xff } : {} }).then(async (r) => { await r.arrayBuffer(); return r.status; });

      // Trusted: two different forwarded clients get separate buckets.
      assert.equal(await get(trusted.origin, "203.0.113.1"), 200);
      assert.equal(await get(trusted.origin, "203.0.113.2"), 200);
      assert.equal(await get(trusted.origin, "203.0.113.1"), 429);

      // Untrusted: the header is ignored, so rotating it does not help the client.
      assert.equal(await get(untrusted.origin, "203.0.113.1"), 200);
      assert.equal(await get(untrusted.origin, "203.0.113.2"), 429);
      assert.equal(await get(untrusted.origin, "203.0.113.3"), 429);
    } finally {
      await trusted.proxy.close();
      await untrusted.proxy.close();
    }
  });
});

describe("per-IP concurrent streams", () => {
  it("returns 429 for a second stream from the same IP, but not for another IP", async () => {
    const one = await startProxy({ maxConcurrentPerIp: 1, maxConcurrent: 10 });
    try {
      const slow = fetch(`${one.origin}${signed(`${up}/slow`)}`, { headers: { "x-forwarded-for": "198.51.100.7" } })
        .then((r) => r.arrayBuffer());
      await new Promise((r) => setTimeout(r, 150));

      const same = await fetch(`${one.origin}${signed(`${up}/seg.bin`)}`, { headers: { "x-forwarded-for": "198.51.100.7" } });
      assert.equal(same.status, 429);
      assert.equal(same.headers.get("retry-after"), "2");
      assert.match(((await same.json()) as { error: string }).error, /concurrent/);

      const other = await fetch(`${one.origin}${signed(`${up}/seg.bin`)}`, { headers: { "x-forwarded-for": "198.51.100.8" } });
      assert.equal(other.status, 200);
      await other.arrayBuffer();
      await slow;
    } finally {
      await one.proxy.close();
    }
  });

  it("releases the per-IP slot when the stream ends", async () => {
    const one = await startProxy({ maxConcurrentPerIp: 1 });
    try {
      await (await fetch(`${one.origin}${signed(`${up}/slow`)}`)).arrayBuffer();
      await settle();
      const res = await fetch(`${one.origin}${signed(`${up}/seg.bin`)}`);
      assert.equal(res.status, 200);
      await res.arrayBuffer();
    } finally {
      await one.proxy.close();
    }
  });

  it("with trust off, rotating X-Forwarded-For does not get around the cap", async () => {
    const one = await startProxy({ maxConcurrentPerIp: 1, trustProxy: false });
    try {
      const slow = fetch(`${one.origin}${signed(`${up}/slow`)}`, { headers: { "x-forwarded-for": "192.0.2.1" } })
        .then((r) => r.arrayBuffer());
      await new Promise((r) => setTimeout(r, 150));
      const res = await fetch(`${one.origin}${signed(`${up}/seg.bin`)}`, { headers: { "x-forwarded-for": "192.0.2.2" } });
      assert.equal(res.status, 429);
      await res.arrayBuffer();
      await slow;
    } finally {
      await one.proxy.close();
    }
  });

  it("global 503 still applies when the per-IP cap is not reached", async () => {
    const one = await startProxy({ maxConcurrent: 1, maxConcurrentPerIp: 16 });
    try {
      const slow = fetch(`${one.origin}${signed(`${up}/slow`)}`).then((r) => r.arrayBuffer());
      await new Promise((r) => setTimeout(r, 150));
      const res = await fetch(`${one.origin}${signed(`${up}/seg.bin`)}`, { headers: { "x-forwarded-for": "192.0.2.9" } });
      assert.equal(res.status, 503);
      await res.arrayBuffer();
      await slow;
    } finally {
      await one.proxy.close();
    }
  });
});

describe("/metrics", () => {
  it("reports counters, bytes and errors after a few requests", async () => {
    const { proxy, origin } = await startProxy();
    try {
      await (await fetch(`${origin}${signed(`${up}/seg.bin`)}`)).arrayBuffer();                 // segment 200
      await (await fetch(`${origin}${signed(`${up}/real/media/index.m3u8`, UA, REFERER)}`)).arrayBuffer(); // playlist 200
      await (await fetch(`${origin}${signed(`${up}/missing.bin`)}`)).arrayBuffer();             // segment 502, bad_status
      await (await fetch(`${origin}/healthz`)).arrayBuffer();                                   // other 200
      await settle();

      const res = await fetch(`${origin}/metrics`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
      const text = await res.text();
      const m = parseMetrics(text);

      assert.equal(m.get('freetv_proxy_requests_total{kind="segment",status="200"}'), 1);
      assert.equal(m.get('freetv_proxy_requests_total{kind="playlist",status="200"}'), 1);
      assert.equal(m.get('freetv_proxy_requests_total{kind="segment",status="502"}'), 1);
      assert.equal(m.get('freetv_proxy_requests_total{kind="other",status="200"}'), 1);
      assert.equal(m.get('freetv_proxy_upstream_errors_total{reason="bad_status"}'), 1);
      assert.equal(m.get("freetv_proxy_rate_limited_total"), 0);
      assert.equal(m.get("freetv_proxy_active_requests"), 0);

      assert.ok((m.get('freetv_proxy_bytes_total{direction="upstream"}') ?? 0) > SEG.length, "upstream bytes include the segment and playlist");
      assert.ok((m.get('freetv_proxy_bytes_total{direction="client"}') ?? 0) >= SEG.length, "client bytes include the segment");

      assert.equal(m.get("freetv_proxy_request_duration_seconds_count"), 4);
      assert.equal(m.get('freetv_proxy_request_duration_seconds_bucket{le="+Inf"}'), 4);
    } finally {
      await proxy.close();
    }
  });

  it("counts 429s by status and in the rate-limited counter", async () => {
    const { proxy, origin } = await startProxy({ rateLimitRps: 0.001, rateLimitBurst: 1 });
    try {
      const path = signed(`${up}/seg.bin`);
      await (await fetch(`${origin}${path}`)).arrayBuffer();
      await (await fetch(`${origin}${path}`)).arrayBuffer();
      await settle();
      const m = parseMetrics(await (await fetch(`${origin}/metrics`)).text());
      assert.equal(m.get('freetv_proxy_requests_total{kind="segment",status="429"}'), 1);
      assert.equal(m.get("freetv_proxy_rate_limited_total"), 1);
    } finally {
      await proxy.close();
    }
  });

  it("access log carries a hashed ip and kind, never the raw address", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
    const { proxy, origin } = await startProxy({ logLevel: "info", trustProxy: true });
    try {
      await (await fetch(`${origin}${signed(`${up}/seg.bin`)}`, { headers: { "x-forwarded-for": "203.0.113.77" } })).arrayBuffer();
      await settle();
    } finally {
      console.log = original;
      await proxy.close();
    }
    const line = lines.find((l) => l.startsWith("proxy GET 200"));
    assert.ok(line, `no access line in ${JSON.stringify(lines)}`);
    assert.match(line, / ip=[0-9a-f]{12} kind=segment$/);
    // The target host (127.0.0.1 here) is logged as before; the client address must not be.
    assert.doesNotMatch(line, /203\.0\.113\.77/);
  });
});

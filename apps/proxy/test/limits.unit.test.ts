import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TokenBucketLimiter } from "../src/ratelimit.js";
import { clientIp, makeIpHasher, normaliseIp } from "../src/clientip.js";
import { createMetrics } from "../src/metrics.js";
import { loadConfig } from "../src/config.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("token bucket", () => {
  it("allows a full burst, then refuses until tokens refill", () => {
    const c = clock();
    const lim = new TokenBucketLimiter(2, 5, c.now);
    for (let i = 0; i < 5; i++) assert.equal(lim.take("a").allowed, true, `request ${i}`);
    const denied = lim.take("a");
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterSec, 1); // one token at 2/s takes 0.5 s, rounded up to 1 s
    c.advance(500);
    assert.equal(lim.take("a").allowed, true);
    assert.equal(lim.take("a").allowed, false);
  });

  it("sustains exactly rps requests per second after the burst", () => {
    const c = clock();
    const lim = new TokenBucketLimiter(10, 1, c.now);
    assert.equal(lim.take("a").allowed, true);
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      c.advance(100); // 10 requests per second in total
      if (lim.take("a").allowed) allowed++;
    }
    assert.equal(allowed, 100);
  });

  it("never refills above the burst", () => {
    const c = clock();
    const lim = new TokenBucketLimiter(1, 3, c.now);
    c.advance(60_000);
    let allowed = 0;
    for (let i = 0; i < 10; i++) if (lim.take("a").allowed) allowed++;
    assert.equal(allowed, 3);
  });

  it("keeps keys independent", () => {
    const c = clock();
    const lim = new TokenBucketLimiter(1, 1, c.now);
    assert.equal(lim.take("a").allowed, true);
    assert.equal(lim.take("a").allowed, false);
    assert.equal(lim.take("b").allowed, true);
  });

  it("reports retry-after from the deficit, not a fixed value", () => {
    const c = clock();
    const lim = new TokenBucketLimiter(0.01, 1, c.now); // one token per 100 s
    lim.take("a");
    assert.equal(lim.take("a").retryAfterSec, 100);
    c.advance(50_000);
    assert.equal(lim.take("a").retryAfterSec, 50);
  });

  it("evicts the least recently used key when the cap is reached", () => {
    const c = clock();
    const lim = new TokenBucketLimiter(1, 1, c.now, 2);
    lim.take("a");
    lim.take("b");
    lim.take("a"); // touches a, so b is now the oldest
    lim.take("c"); // evicts b
    assert.equal(lim.size, 2);
    // a was touched and is still limited (empty bucket); b was evicted and starts full again.
    assert.equal(lim.take("a").allowed, false);
    assert.equal(lim.take("b").allowed, true);
  });

  it("sweep drops only buckets that have fully refilled", () => {
    const c = clock();
    const lim = new TokenBucketLimiter(10, 2, c.now); // full again after 0.2 s
    lim.take("idle");
    lim.take("busy");
    c.advance(150);
    lim.take("busy");
    c.advance(100); // idle: 250 ms since last use (full). busy: 100 ms since last use (not full).
    assert.equal(lim.sweep(), 1);
    assert.equal(lim.size, 1);
  });

  it("rejects invalid parameters", () => {
    assert.throws(() => new TokenBucketLimiter(0, 1));
    assert.throws(() => new TokenBucketLimiter(1, 0));
  });
});

describe("client IP", () => {
  it("normalises IPv4-mapped IPv6 in both the dotted and hex forms", () => {
    assert.equal(normaliseIp("::ffff:203.0.113.5"), "203.0.113.5");
    assert.equal(normaliseIp("::FFFF:CB00:7105"), "203.0.113.5");
    assert.equal(normaliseIp("2001:DB8::1"), "2001:db8::1");
  });

  it("takes the LAST X-Forwarded-For entry when trusted (the one Caddy appended; a spoofed first entry is ignored)", () => {
    const ip = clientIp({ forwardedFor: "1.2.3.4, 203.0.113.5", socketAddress: "10.0.0.9", trustProxy: true });
    assert.equal(ip, "203.0.113.5");
  });

  it("joins a repeated header the way Node delivers it as an array", () => {
    const ip = clientIp({ forwardedFor: ["203.0.113.5", "198.51.100.1"], socketAddress: "10.0.0.9", trustProxy: true });
    assert.equal(ip, "198.51.100.1");
  });

  it("ignores X-Forwarded-For entirely when trust is off (spoof attempt)", () => {
    const ip = clientIp({ forwardedFor: "1.2.3.4", socketAddress: "::ffff:10.0.0.9", trustProxy: false });
    assert.equal(ip, "10.0.0.9");
  });

  it("falls back to the socket address when the forwarded value is not an IP", () => {
    for (const bad of ["garbage", "1.2.3.4:80", "", "'; drop table"]) {
      assert.equal(clientIp({ forwardedFor: bad, socketAddress: "10.0.0.9", trustProxy: true }), "10.0.0.9", bad);
    }
  });

  it("hashes addresses to 12 hex characters without the raw value", () => {
    const hash = makeIpHasher();
    const h = hash("203.0.113.5");
    assert.match(h, /^[0-9a-f]{12}$/);
    assert.equal(h, hash("203.0.113.5"));
    assert.notEqual(h, hash("203.0.113.6"));
  });
});

describe("metrics registry", () => {
  it("renders counters with sorted label order and escapes values", () => {
    const m = createMetrics();
    m.requests.inc({ kind: "segment", status: "200" });
    m.requests.inc({ kind: "segment", status: "200" }, 2);
    m.upstreamErrors.inc({ reason: 'a"b\\c' });
    const text = m.render();
    assert.match(text, /^# HELP freetv_proxy_requests_total /m);
    assert.match(text, /^# TYPE freetv_proxy_requests_total counter$/m);
    assert.match(text, /^freetv_proxy_requests_total\{kind="segment",status="200"\} 3$/m);
    assert.match(text, /^freetv_proxy_upstream_errors_total\{reason="a\\"b\\\\c"\} 1$/m);
    assert.match(text, /^freetv_proxy_rate_limited_total 0$/m);
  });

  it("renders histogram buckets cumulatively with +Inf, sum and count", () => {
    const m = createMetrics();
    m.duration.observe(0.04);
    m.duration.observe(0.3);
    m.duration.observe(100);
    const text = m.render();
    assert.match(text, /^freetv_proxy_request_duration_seconds_bucket\{le="0\.05"\} 1$/m);
    assert.match(text, /^freetv_proxy_request_duration_seconds_bucket\{le="0\.25"\} 1$/m);
    assert.match(text, /^freetv_proxy_request_duration_seconds_bucket\{le="0\.5"\} 2$/m);
    assert.match(text, /^freetv_proxy_request_duration_seconds_bucket\{le="30"\} 2$/m);
    assert.match(text, /^freetv_proxy_request_duration_seconds_bucket\{le="\+Inf"\} 3$/m);
    assert.match(text, /^freetv_proxy_request_duration_seconds_count 3$/m);
    assert.match(text, /^freetv_proxy_request_duration_seconds_sum 100\.34/m);
  });
});

describe("config for limits", () => {
  const base = { PROXY_SECRET: "s" };
  it("defaults to 20 rps, burst 60, 16 per IP, trust on", () => {
    const c = loadConfig(base);
    assert.equal(c.rateLimitRps, 20);
    assert.equal(c.rateLimitBurst, 60);
    assert.equal(c.maxConcurrentPerIp, 16);
    assert.equal(c.trustProxy, true);
  });

  it("accepts 0 to disable the rate limiter and per-IP cap", () => {
    const c = loadConfig({ ...base, PROXY_RATE_LIMIT_RPS: "0", PROXY_MAX_CONCURRENT_PER_IP: "0" });
    assert.equal(c.rateLimitRps, 0);
    assert.equal(c.maxConcurrentPerIp, 0);
  });

  it("rejects malformed values instead of silently defaulting", () => {
    assert.throws(() => loadConfig({ ...base, PROXY_RATE_LIMIT_RPS: "-1" }));
    assert.throws(() => loadConfig({ ...base, PROXY_RATE_LIMIT_BURST: "0" }));
    assert.throws(() => loadConfig({ ...base, PROXY_TRUST_PROXY: "yes" }));
    assert.equal(loadConfig({ ...base, PROXY_TRUST_PROXY: "false" }).trustProxy, false);
  });
});

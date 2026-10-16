import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { makeProxyUrl, signPayload } from "../src/lib/sign.js";
import { proxyUrlFor } from "../src/lib/views.js";
import { renderM3u, type M3uOptions } from "../src/lib/export-m3u.js";
import type { ExportChannel, ExportStream } from "../src/lib/export-query.js";

config.logLevel = "silent";
config.proxyEnabled = true;
config.proxySecret = "test-secret";
config.proxyPublicPath = "/proxy";

const nowSec = () => Math.floor(Date.now() / 1000);
const payloadOf = (url: string) => JSON.parse(Buffer.from(url.split("/").pop() as string, "base64url").toString("utf8")) as {
  u: string;
  ua?: string;
  r?: string;
  exp: number;
};

describe("makeProxyUrl", () => {
  test("payload carries exp and the signature covers it", () => {
    const url = makeProxyUrl("k", "/proxy", "https://a.example/x.m3u8", "UA/1", null, 1_900_000_000);
    const [, , sig, payload] = url.split("/");
    assert.equal(sig, signPayload("k", payload));
    assert.deepEqual(payloadOf(url), { u: "https://a.example/x.m3u8", ua: "UA/1", exp: 1_900_000_000 });
  });

  test("changing exp changes the signature (a stored URL cannot be extended)", () => {
    const a = makeProxyUrl("k", "/proxy", "https://a.example/x.ts", null, null, 1_900_000_000);
    const b = makeProxyUrl("k", "/proxy", "https://a.example/x.ts", null, null, 1_900_086_400);
    assert.notEqual(a.split("/")[2], b.split("/")[2]);
  });
});

describe("proxyUrlFor TTLs", () => {
  test("defaults to 24 h (PROXY_URL_TTL_SECONDS)", () => {
    const before = nowSec();
    const url = proxyUrlFor("https://a.example/x.ts", null, null);
    const after = nowSec();
    assert.ok(url);
    const { exp } = payloadOf(url);
    assert.ok(exp >= before + config.proxyUrlTtlSeconds && exp <= after + config.proxyUrlTtlSeconds, `exp ${exp}`);
    if (process.env.PROXY_URL_TTL_SECONDS === undefined) assert.equal(config.proxyUrlTtlSeconds, 86400);
  });

  test("an explicit exp is used as given", () => {
    const url = proxyUrlFor("https://a.example/x.ts", null, null, 1_900_000_000);
    assert.equal(payloadOf(url!).exp, 1_900_000_000);
  });

  test("returns undefined when the proxy is off", () => {
    const was = config.proxyEnabled;
    config.proxyEnabled = false;
    try {
      assert.equal(proxyUrlFor("https://a.example/x.ts", null, null), undefined);
    } finally {
      config.proxyEnabled = was;
    }
  });

  test("the M3U renderer asks for the export TTL (PROXY_EXPORT_TTL_SECONDS, 7 d by default)", () => {
    const stream: ExportStream = { url: "https://a.example/x.ts", title: null, userAgent: null, referrer: null };
    const channel: ExportChannel = { id: "A.xx", name: "A", country: null, logo: null, categories: [], languages: [], streams: [stream] };
    const asked: number[] = [];
    const opts: M3uOptions = {
      base: "https://tv.example.test",
      proxy: true,
      streams: "best",
      proxyPathFor: (_s, exp) => {
        asked.push(exp);
        return "/proxy/sig/payload";
      },
      truncated: false,
    };
    const text = renderM3u([channel], opts);
    assert.equal(asked.length, 1);
    const want = nowSec() + config.proxyExportTtlSeconds;
    assert.ok(Math.abs(asked[0] - want) <= 5, `exp ${asked[0]} is about ${want}`);
    assert.ok(text.includes("https://tv.example.test/proxy/sig/payload"));
    if (process.env.PROXY_EXPORT_TTL_SECONDS === undefined) assert.equal(config.proxyExportTtlSeconds, 604800);
  });
});

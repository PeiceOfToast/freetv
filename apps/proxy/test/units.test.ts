import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, isBlockedHostname } from "../src/ssrf.js";
import { loadConfig } from "../src/config.js";
import { rewritePlaylist, isPlaylist } from "../src/playlist.js";
import { makeProxyUrl, signPayload, verifySignature } from "../src/sign.js";

describe("address classification", () => {
  it("blocks private, loopback, link-local and metadata ranges", () => {
    for (const ip of ["0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "::", "::1", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::808:808"]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "::ffff:8.8.8.8", "::ffff:808:808", "2606:4700:4700::1111"]) {
      assert.equal(isBlockedAddress(ip), false, ip);
    }
  });

  it("blocks sensitive hostnames", () => {
    assert.equal(isBlockedHostname("localhost"), true);
    assert.equal(isBlockedHostname("LOCALHOST."), true);
    assert.equal(isBlockedHostname("a.local"), true);
    assert.equal(isBlockedHostname("example.com"), false);
  });
});

describe("config", () => {
  it("requires PROXY_SECRET and defaults safely", () => {
    assert.throws(() => loadConfig({}));
    const c = loadConfig({ PROXY_SECRET: "s" });
    assert.equal(c.publicPath, "/proxy");
    assert.equal(c.allowPrivate, false);
    assert.equal(c.maxBytes, 50 * 1024 * 1024);
    assert.equal(c.maxConcurrent, 200);
    assert.equal(c.port, 3001);
  });

  it("normalises PROXY_PUBLIC_PATH and reads PROXY_ALLOW_PRIVATE", () => {
    const c = loadConfig({ PROXY_SECRET: "s", PROXY_PUBLIC_PATH: "media/", PROXY_ALLOW_PRIVATE: "true" });
    assert.equal(c.publicPath, "/media");
    assert.equal(c.allowPrivate, true);
  });
});

describe("signing", () => {
  it("makeProxyUrl output verifies and carries ua/r only when given", () => {
    const url = makeProxyUrl("k", "/proxy", "https://a.example/x.m3u8", null, null);
    const [, , sig, payload] = url.split("/");
    assert.ok(verifySignature("k", payload, sig));
    assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { u: "https://a.example/x.m3u8" });
    assert.equal(verifySignature("other", payload, sig), false);
    assert.equal(verifySignature("k", payload, signPayload("k", "tampered")), false);
  });
});

describe("playlist helpers", () => {
  const base = new URL("https://cdn.example/a/b/master.m3u8");
  const opts = { secret: "k", publicPath: "/proxy" };

  it("leaves comments, blank lines and non-http URIs alone", () => {
    const out = rewritePlaylist("#EXTM3U\n\n#EXT-X-KEY:METHOD=AES-128,URI=\"skd://x\"\nskd://y\nsub.m3u8", base, opts);
    const lines = out.split("\n");
    assert.equal(lines[0], "#EXTM3U");
    assert.equal(lines[1], "");
    assert.equal(lines[2], '#EXT-X-KEY:METHOD=AES-128,URI="skd://x"');
    assert.equal(lines[3], "skd://y");
    assert.ok(lines[4].startsWith("/proxy/"));
  });

  it("detects playlists by content type or path", () => {
    assert.equal(isPlaylist("application/x-mpegURL", new URL("https://x/a.bin")), true);
    assert.equal(isPlaylist("text/plain", new URL("https://x/a.m3u8?t=1")), true);
    assert.equal(isPlaylist("video/mp2t", new URL("https://x/a.ts")), false);
  });
});
